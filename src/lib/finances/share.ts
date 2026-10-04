import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { getSupabaseAdmin } from '../supabase/server';
import { audit } from './audit';

/**
 * Expiring download links for people without a CoinPay login.
 *
 * A link is a 256-bit random token that the database knows only as its
 * SHA-256. It is created by one deliberate action of the merchant (emailing
 * a report or the books), it expires, it counts its downloads, and it can
 * be revoked. What it serves is exactly what the merchant could download
 * themselves; it grants nothing else, and it is never listed anywhere a
 * browser cache or a log would keep it.
 */

export interface ShareLinkRow {
  id: string;
  merchant_id: string;
  kind: 'report' | 'books';
  report_id: string | null;
  params: Record<string, unknown>;
  formats: string[];
  expires_at: string;
  max_downloads: number | null;
  downloads: number;
  recipients: string[];
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

const COLUMNS = 'id, merchant_id, kind, report_id, params, formats, expires_at, max_downloads, downloads, recipients, revoked_at, last_used_at, created_at';

export const DEFAULT_LINK_DAYS = Number(process.env.FINANCES_SHARE_LINK_DAYS ?? 14);

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com').replace(/\/$/, '');
}

export async function createShareLink(input: {
  merchantId: string;
  kind: 'report' | 'books';
  reportId?: string | null;
  params?: Record<string, unknown>;
  formats: string[];
  recipients: string[];
  expiresInDays?: number;
  maxDownloads?: number | null;
}): Promise<{ row: ShareLinkRow; token: string; url: string }> {
  const supabase = getSupabaseAdmin();
  const token = randomBytes(32).toString('base64url');
  const days = Math.min(Math.max(input.expiresInDays ?? DEFAULT_LINK_DAYS, 1), 90);
  const { data, error } = await supabase
    .from('finance_share_links')
    .insert({
      merchant_id: input.merchantId,
      kind: input.kind,
      report_id: input.reportId ?? null,
      params: input.params ?? {},
      formats: input.formats,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      max_downloads: input.maxDownloads ?? null,
      recipients: input.recipients,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`Could not create the share link: ${error.message}`);
  const row = data as ShareLinkRow;
  await audit(input.merchantId, 'share_link.create', 'share_link', row.id, { kind: input.kind, recipients: input.recipients.length, days });
  return { row, token, url: `${appBaseUrl()}/api/finances/shared/${token}` };
}

/** The link for a token, if it is live. Does not count a download. */
export async function resolveShareLink(token: string): Promise<ShareLinkRow | null> {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_share_links')
    .select(COLUMNS)
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error) throw new Error(`Could not read the share link: ${error.message}`);
  const row = (data as ShareLinkRow | null) ?? null;
  if (!row) return null;
  if (row.revoked_at) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  if (row.max_downloads !== null && row.downloads >= row.max_downloads) return null;
  return row;
}

export async function countShareDownload(row: ShareLinkRow): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from('finance_share_links')
    .update({ downloads: row.downloads + 1, last_used_at: new Date().toISOString() })
    .eq('id', row.id);
  await audit(row.merchant_id, 'share_link.download', 'share_link', row.id, { kind: row.kind });
}

export async function revokeShareLink(linkId: string, merchantId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId)
    .eq('merchant_id', merchantId)
    .is('revoked_at', null)
    .select('id');
  if (error) throw new Error(`Could not revoke the share link: ${error.message}`);
  const ok = (data ?? []).length > 0;
  if (ok) await audit(merchantId, 'share_link.revoke', 'share_link', linkId, {});
  return ok;
}

export async function listShareLinks(merchantId: string, { limit = 50 }: { limit?: number } = {}): Promise<ShareLinkRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_share_links')
    .select(COLUMNS)
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new Error(`Could not list share links: ${error.message}`);
  return (data ?? []) as ShareLinkRow[];
}

export function toPublicShareLink(row: ShareLinkRow) {
  return {
    id: row.id,
    kind: row.kind,
    reportId: row.report_id,
    params: row.params,
    formats: row.formats,
    recipients: row.recipients,
    expiresAt: row.expires_at,
    downloads: row.downloads,
    maxDownloads: row.max_downloads,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}
