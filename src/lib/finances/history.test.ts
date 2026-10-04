import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        in: async () => ({ data: [{ report_id: 'r1', format: 'pdf', state: 'ready' }, { report_id: 'r1', format: 'csv', state: 'pending' }] }),
      }),
    }),
  }),
}));
vi.mock('./reports', () => ({
  listReports: async () => ({
    reports: [{ id: 'r1', period_label: 'September 2026', scope: 'business', row_count: 12, revision: 1, status: 'ready', created_at: '2026-10-01T00:00:00Z', generated_at: '2026-10-01T00:01:00Z' }],
    total: 1,
  }),
}));
vi.mock('./share', () => ({
  listShareLinks: async () => [
    { id: 's1', kind: 'report', report_id: 'r1', params: {}, formats: ['pdf'], recipients: ['cpa@x.test'], downloads: 2, expires_at: '2099-01-01T00:00:00Z', revoked_at: null, created_at: '2026-10-02T00:00:00Z' },
    { id: 's2', kind: 'books', report_id: null, params: { start: '2026-07-01T07:00:00Z', end: '2026-10-01T07:00:00Z', scope: 'business', label: '2026-Q3' }, formats: ['pdf', 'csv'], recipients: ['mom@x.test'], downloads: 0, expires_at: '2020-01-01T00:00:00Z', revoked_at: null, created_at: '2026-10-03T00:00:00Z' },
  ],
}));
vi.mock('./jobs', () => ({
  listJobs: async () => [
    { id: 'j1', kind: 'email_report', status: 'failed', params: { scheduleId: 'x' }, error_message: 'mail down', created_at: '2026-09-30T00:00:00Z' },
    { id: 'j2', kind: 'email_report', status: 'completed', params: {}, created_at: '2026-09-29T00:00:00Z' },
    { id: 'j3', kind: 'refresh', status: 'failed', params: {}, created_at: '2026-09-28T00:00:00Z' },
  ],
}));
vi.mock('./documents', () => ({
  listDocuments: async () => [
    { id: 'd1', title: 'Monthly spend report', category: 'report', period_label: '2026-10', notes: null, original_filename: 'spend.pdf', bytes: 13000, created_at: '2026-10-04T00:00:00Z' },
  ],
  toPublicDocument: (d: { id: string }) => ({ downloadUrl: `/api/finances/documents/${d.id}/download` }),
}));

import { buildHistory } from './history';

describe('buildHistory', () => {
  it('merges every source newest first', async () => {
    const items = await buildHistory('owner-1');
    expect(items.map((i) => `${i.type}:${i.id}`)).toEqual(['uploaded:d1', 'emailed:s2', 'emailed:s1', 'generated:r1', 'digest:j1']);
  });

  it('offers only ready artifacts for a generated report', async () => {
    const r = (await buildHistory('owner-1')).find((i) => i.id === 'r1')!;
    expect(r.downloads.map((d) => d.label)).toEqual(['PDF']);
  });

  it('labels emailed items with recipients, opens and status', async () => {
    const items = await buildHistory('owner-1');
    const report = items.find((i) => i.id === 's1')!;
    expect(report).toMatchObject({ title: 'Report emailed: September 2026', recipients: ['cpa@x.test'], openedCount: 2, status: 'active' });
    const books = items.find((i) => i.id === 's2')!;
    expect(books.title).toBe('Books (CPA pack) emailed: 2026-Q3');
    expect(books.status).toBe('expired');
    expect(books.downloads[0].url).toContain('from=2026-07-01');
  });

  it('shows only unfinished email jobs, and filters by type', async () => {
    const digests = await buildHistory('owner-1', { types: ['digest'] });
    expect(digests.map((i) => i.id)).toEqual(['j1']);
  });
});
