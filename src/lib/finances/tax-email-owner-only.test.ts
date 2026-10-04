import { describe, it, expect, vi } from 'vitest';

/** Tax documents go by email only to the books owner's own address. */

vi.mock('server-only', () => ({}));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
vi.mock('./reports', () => ({ getReport: vi.fn(), getReportDataset: vi.fn(), readArtifact: vi.fn() }));
vi.mock('./books', () => ({ booksSummary: vi.fn(), renderBooksCsv: vi.fn(), renderBooksHtml: vi.fn(), renderBooksPdf: vi.fn(), toPublicRow: vi.fn() }));
vi.mock('./share', () => ({ createShareLink: vi.fn() }));
vi.mock('./audit', () => ({ audit: vi.fn() }));
vi.mock('./tax-pack', () => ({ taxAttachmentsFor: vi.fn() }));
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: 'owner@example.com' } }) }) }) }) }),
}));

import { ownerOnlyRecipientsError, sendBooksEmail, taxDocumentsHtml } from './emailing';
import { createShareLink } from './share';

describe('tax documents by email', () => {
  it('only to the owner', () => {
    expect(ownerOnlyRecipientsError('Owner@Example.com', ['owner@example.com'])).toBeNull();
    expect(ownerOnlyRecipientsError('owner@example.com', ['owner@example.com', 'someone@example.com'])?.code).toBe('tax_documents_owner_only');
    expect(ownerOnlyRecipientsError(null, ['owner@example.com'])?.message).toMatch(/no email address on file/);
  });

  it('refuses before anything is built or sent', async () => {
    await expect(sendBooksEmail({ merchantId: 'm-1', selection: { period: '2025', timezone: 'UTC', scope: 'business' }, to: 'someone@example.com', withDocuments: true }))
      .rejects.toMatchObject({ code: 'tax_documents_owner_only', status: 400 });
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it('names what did not fit', () => {
    const html = taxDocumentsHtml({ attached: ['notice.pdf'], skipped: [{ title: 'Big transcript', reason: '9.0 MiB does not fit in the 8 MiB limit' }] });
    expect(html).toContain('notice.pdf');
    expect(html).toContain('Big transcript');
    expect(taxDocumentsHtml({ attached: [], skipped: [] })).toMatch(/No tax documents/);
  });
});
