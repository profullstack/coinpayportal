import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('./audit', () => ({ audit: vi.fn() }));

const m = vi.hoisted(() => {
  class ReportError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { createReport: vi.fn(), getReport: vi.fn(), sendReportEmail: vi.fn(), sendBooksEmail: vi.fn(), ReportError };
});
const { createReport, getReport, sendReportEmail, sendBooksEmail, ReportError } = m;
vi.mock('./reports', () => ({ createReport: m.createReport, getReport: m.getReport, ReportError: m.ReportError }));
vi.mock('./emailing', async () => {
  const actual = await vi.importActual<typeof import('./emailing')>('./emailing');
  return {
    ...actual,
    sendReportEmail: m.sendReportEmail,
    sendBooksEmail: m.sendBooksEmail,
    renderBooksFormat: vi.fn(async (_s: unknown, format: string) => ({ bytes: Buffer.from('x'), filename: `books.${format}`, contentType: 'text/plain' })),
  };
});
vi.mock('./books', () => ({
  booksSummary: vi.fn(async () => ({ start: '2026-09-07', end: '2026-09-14', scope: 'business', lines: [], totals: [{ currency: 'USD', income: '10', expenses: '4', net: '6', excluded: '0' }], rows: 3, unreviewed: 1, uncategorized: 0, transactions: [], notice: '' })),
}));

import { sendDigest, type EmailScheduleRow } from './schedules';

const schedule: EmailScheduleRow = {
  id: 'sched-1', merchant_id: 'm1', kind: 'weekly_digest', weekdays: [1], hour: 6, timezone: 'America/Los_Angeles',
  recipients: ['me@example.com'], scope: 'business', formats: ['pdf', 'csv'], active: true, last_sent_at: null, next_run_at: null,
  created_at: '', updated_at: '',
};
// A Monday 06:00 Pacific: the digest covers Monday to Sunday of the week before.
const monday = new Date('2026-09-14T13:00:00.000Z');
const outcome = { sent: ['me@example.com'], failed: [], attached: ['r.pdf'], linkUrl: 'https://x', linkExpiresAt: '2026-09-28' };

beforeEach(() => {
  createReport.mockReset();
  getReport.mockReset();
  sendReportEmail.mockReset();
  sendBooksEmail.mockReset();
});

describe('sendDigest', () => {
  it('creates the week\'s activity report with a stable key and waits for it', async () => {
    createReport.mockResolvedValue({ report: { id: 'rep-1', status: 'queued' }, job: { id: 'job-1' } });
    getReport.mockResolvedValue({ id: 'rep-1', status: 'generating' });
    await expect(sendDigest(schedule, monday)).rejects.toMatchObject({ code: 'report_not_ready' });
    expect(createReport).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 'm1', from: '2026-09-07', to: '2026-09-14', scope: 'business', idempotencyKey: 'digest:sched-1:2026-09-07' }));
    expect(sendReportEmail).not.toHaveBeenCalled();
    expect(sendBooksEmail).not.toHaveBeenCalled();
  });

  it('sends the ready report with its summary, the books block and the pack attached', async () => {
    createReport.mockResolvedValue({ report: { id: 'rep-1', status: 'ready' }, job: { id: 'job-1' } });
    sendReportEmail.mockResolvedValue(outcome);
    const result = await sendDigest(schedule, monday);
    expect(result).toMatchObject({ sent: ['me@example.com'], rows: 3, unreviewed: 1 });
    const call = sendReportEmail.mock.calls[0][0];
    expect(call).toMatchObject({ reportId: 'rep-1', to: ['me@example.com'], formats: ['pdf', 'csv'], subjectPrefix: 'CoinPay weekly digest' });
    expect(call.extraAttachments.map((a: { filename: string }) => a.filename)).toEqual(['books.pdf', 'books.csv']);
    expect(call.extraBody).toContain('Books for 2026-09-07 to 2026-09-13 (business)');
    expect(call.message).toContain('2026-09-07 to 2026-09-13');
    expect(sendBooksEmail).not.toHaveBeenCalled();
  });

  it('falls back to the books pack when the report failed or cannot be created', async () => {
    createReport.mockResolvedValue({ report: { id: 'rep-1', status: 'queued' }, job: { id: 'job-1' } });
    getReport.mockResolvedValue({ id: 'rep-1', status: 'failed' });
    sendBooksEmail.mockResolvedValue({ ...outcome, rows: 3, unreviewed: 1 });
    await sendDigest(schedule, monday);
    expect(sendBooksEmail).toHaveBeenCalledWith(expect.objectContaining({ subjectPrefix: 'CoinPay weekly digest' }));
    expect(sendBooksEmail.mock.calls[0][0].message).toContain('could not be generated');

    sendBooksEmail.mockClear();
    createReport.mockRejectedValue(new ReportError('invalid_request', 'No accounts match this selection; nothing to report on'));
    await sendDigest(schedule, monday);
    expect(sendBooksEmail.mock.calls[0][0].message).toContain('No activity report this week: No accounts match');
    expect(sendReportEmail).not.toHaveBeenCalled();
  });
});
