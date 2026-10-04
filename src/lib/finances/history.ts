import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { listReports } from './reports';
import { listShareLinks } from './share';
import { listJobs } from './jobs';
import { listDocuments, toPublicDocument } from './documents';

/**
 * One timeline of every business report a merchant has: what CoinPay generated,
 * what was emailed (and to whom, and whether it was opened), scheduled digests
 * that are still queued or failed, and documents uploaded from elsewhere.
 *
 * Sources, all already scoped by the books' owner:
 *  - finance_reports + artifacts  -> "generated", with a download per format
 *  - finance_share_links          -> "emailed": every report send, CPA pack and
 *                                    digest leaves one (recipients, downloads, expiry)
 *  - finance_jobs (email_report)  -> "digest": only queued/failed runs; a sent
 *                                    one is already its share link
 *  - finance_documents            -> "uploaded"
 */

export type HistoryType = 'generated' | 'emailed' | 'digest' | 'uploaded';

export interface HistoryItem {
  type: HistoryType;
  id: string;
  at: string;
  title: string;
  detail: string | null;
  status: string | null;
  downloads: Array<{ label: string; url: string }>;
  recipients?: string[];
  openedCount?: number;
  expiresAt?: string | null;
  revoked?: boolean;
  category?: string;
  reportId?: string | null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function periodOf(params: Record<string, unknown>): string | null {
  if (typeof params.label === 'string') return params.label;
  if (typeof params.start === 'string' && typeof params.end === 'string') {
    return `${params.start.slice(0, 10)} to ${params.end.slice(0, 10)}`;
  }
  return null;
}

export async function buildHistory(
  merchantId: string,
  { limit = 200, types }: { limit?: number; types?: HistoryType[] } = {},
): Promise<HistoryItem[]> {
  const want = (t: HistoryType) => !types || types.length === 0 || types.includes(t);
  const items: HistoryItem[] = [];

  const [reportsRes, links, jobs, docs] = await Promise.all([
    want('generated') || want('emailed') ? listReports(merchantId, { limit: 200 }) : Promise.resolve({ reports: [], total: 0 }),
    want('emailed') ? listShareLinks(merchantId, { limit: 200 }) : Promise.resolve([]),
    want('digest') ? listJobs(merchantId, { limit: 100 }) : Promise.resolve([]),
    want('uploaded') ? listDocuments(merchantId, { limit: 200 }) : Promise.resolve([]),
  ]);

  const reportLabel = new Map(reportsRes.reports.map((r) => [r.id, r.period_label]));

  if (want('generated') && reportsRes.reports.length > 0) {
    const { data: artifacts } = await getSupabaseAdmin()
      .from('finance_report_artifacts')
      .select('report_id, format, state')
      .in('report_id', reportsRes.reports.map((r) => r.id));
    const formats = new Map<string, string[]>();
    for (const a of (artifacts ?? []) as Array<{ report_id: string; format: string; state: string }>) {
      if (a.state !== 'ready') continue;
      formats.set(a.report_id, [...(formats.get(a.report_id) ?? []), a.format]);
    }
    for (const r of reportsRes.reports) {
      const fs = formats.get(r.id) ?? [];
      items.push({
        type: 'generated',
        id: r.id,
        at: r.generated_at ?? r.created_at,
        title: `Finance report: ${r.period_label}`,
        detail: [r.scope !== 'all' ? `${r.scope} accounts` : 'all accounts', r.row_count != null ? `${r.row_count} transactions` : null, r.revision > 1 ? `revision ${r.revision}` : null]
          .filter(Boolean)
          .join(' · '),
        status: r.status,
        downloads: fs.map((f) => ({ label: f.toUpperCase(), url: `/api/finances/reports/${r.id}/download?format=${f}` })),
        reportId: r.id,
      });
    }
  }

  for (const l of links) {
    const period = periodOf(l.params);
    const what =
      l.kind === 'report'
        ? `Report emailed: ${reportLabel.get(l.report_id ?? '') ?? 'finance report'}`
        : `Books (CPA pack) emailed${period ? `: ${period}` : ''}`;
    // A books pack is rendered at send time and not stored; offer the same
    // period rebuilt from the books as they stand now.
    const p = l.params as { start?: string; end?: string; scope?: string; timezone?: string };
    const booksDownloads =
      l.kind === 'books' && p.start && p.end
        ? ['pdf', 'csv'].map((f) => ({
            label: `${f.toUpperCase()} (current books)`,
            url: `/api/finances/books/export?${new URLSearchParams({
              from: p.start!.slice(0, 10),
              to: p.end!.slice(0, 10),
              scope: p.scope ?? 'business',
              ...(p.timezone ? { timezone: p.timezone } : {}),
              format: f,
            }).toString()}`,
          }))
        : [];
    items.push({
      type: 'emailed',
      id: l.id,
      at: l.created_at,
      title: what,
      detail: l.formats.length ? l.formats.map((f) => f.toUpperCase()).join(', ') : null,
      status: l.revoked_at ? 'revoked' : new Date(l.expires_at).getTime() < Date.now() ? 'expired' : 'active',
      downloads:
        l.kind === 'report' && l.report_id
          ? l.formats.map((f) => ({ label: f.toUpperCase(), url: `/api/finances/reports/${l.report_id}/download?format=${f}` }))
          : booksDownloads,
      recipients: l.recipients,
      openedCount: l.downloads,
      expiresAt: l.expires_at,
      revoked: Boolean(l.revoked_at),
      reportId: l.report_id,
    });
  }

  for (const j of jobs) {
    if (j.kind !== 'email_report' || j.status === 'completed' || j.status === 'cancelled') continue;
    items.push({
      type: 'digest',
      id: j.id,
      at: j.created_at,
      title: j.params.scheduleId ? 'Scheduled digest' : 'Email send',
      detail: j.error_message ?? null,
      status: j.status,
      downloads: [],
    });
  }

  for (const d of docs) {
    const pub = toPublicDocument(d);
    items.push({
      type: 'uploaded',
      id: d.id,
      at: d.created_at,
      title: d.title,
      detail: [d.period_label, d.original_filename, fmtBytes(d.bytes), d.notes].filter(Boolean).join(' · '),
      status: null,
      downloads: [{ label: (d.original_filename?.split('.').pop() ?? 'file').toUpperCase(), url: pub.downloadUrl }],
      category: d.category,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return items.slice(0, Math.min(Math.max(limit, 1), 500));
}
