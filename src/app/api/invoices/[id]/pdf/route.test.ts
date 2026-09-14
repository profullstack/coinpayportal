import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { invoiceSnapshot, PUBLIC_INVOICE_PDF_FIELDS } from '@/lib/invoices/pdf';

const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }));
const id = '11111111-2222-4333-8444-555555555555';
// PRIVATE-* values are synthetic markers used to detect accidental disclosure.
const fixture = () => ({
  invoice_number: 'INV-001', status: 'sent', currency: 'USD', amount: '40.00',
  due_date: null, created_at: '2026-09-14T00:00:00+00:00', businesses: { name: 'Phuc Nguyen', id: 'PRIVATE-business' },
  notes: 'PRIVATE-notes', metadata: { internal_note: 'PRIVATE-metadata' },
  clients: { email: 'PRIVATE-email', address: 'PRIVATE-address' },
  merchant_wallet_address: 'PRIVATE-wallet', payment_address: 'PRIVATE-deposit',
  stripe_checkout_url: 'https://private.example', crypto_amount: '987654321', fee_amount: 'SECRET-FEE',
});
const request = (invoiceId = id) => GET(new NextRequest(`http://localhost/api/invoices/${invoiceId}/pdf`, {
  headers: { host: 'hostile.example', 'x-forwarded-host': 'hostile.example' },
}), { params: Promise.resolve({ id: invoiceId }) });
const readerAvailable = spawnSync('pdftotext', ['-v']).status === 0;

describe('public invoice PDF (real jsPDF renderer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://coinpayportal.com');
    vi.stubEnv('INVOICE_PUBLIC_ORIGIN', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.from.mockReturnValue(db); db.select.mockReturnValue(db); db.eq.mockReturnValue(db);
    db.single.mockResolvedValue({ data: fixture(), error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each(['sent', 'overdue', 'paid'])('renders a %s snapshot with safe download headers', async status => {
    db.single.mockResolvedValue({ data: { ...fixture(), status }, error: null });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="invoice-${id}.pdf"`);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeLessThan(150_000);
    expect(bytes.toString('latin1')).toContain('/Count 1');
    expect(db.select).toHaveBeenCalledWith(PUBLIC_INVOICE_PDF_FIELDS);
    expect(db.eq).toHaveBeenCalledWith('id', id);
  });

  it.each(['draft', 'cancelled', 'rejected', 'pending', 'unknown', null])('hides %s invoices identically to missing records', async status => {
    db.single.mockResolvedValue({ data: { ...fixture(), status }, error: null });
    const hidden = await request();
    db.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    const missing = await request();
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
    expect(missing.status).toBe(404);
    expect(hidden.headers.get('Cache-Control')).toContain('no-store');
  });

  it.each(['../send', 'not-an-id', `${id}\r\nInjected: yes`, `${id}?token=secret`])('rejects invalid ID %j before querying', async invalid => {
    expect((await request(invalid)).status).toBe(404);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('projects exactly the public fields even if the database mock returns extra data', () => {
    expect(invoiceSnapshot(fixture())).toEqual({
      invoice_number: 'INV-001', status: 'sent', amount: '40.00', currency: 'USD',
      created_at: fixture().created_at, due_date: null, businesses: { name: 'Phuc Nguyen' },
    });
    expect(PUBLIC_INVOICE_PDF_FIELDS.split(',')).toEqual([
      'invoice_number', 'status', 'currency', 'amount', 'due_date', 'created_at', 'businesses(name)',
    ]);
  });

  it.each([NaN, Infinity, -40, 0, '40.001', '1e3', '1000000000000', null, '40\n', '0x28'])('refuses malformed amount %j', async amount => {
    db.single.mockResolvedValue({ data: { ...fixture(), amount }, error: null });
    expect((await request()).status).toBe(503);
  });

  it.each([
    { currency: 'ABC' }, { created_at: 'bad date' }, { businesses: null },
    { invoice_number: 'a'.repeat(241) }, { invoice_number: 'bad\nHeader' },
    { invoice_number: 'UNSUPPORTED-\u{1f680}' }, { invoice_number: '\u202ereversed' },
  ])('fails closed on unsupported public data %j', async extra => {
    db.single.mockResolvedValue({ data: { ...fixture(), ...extra }, error: null });
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE');
  });

  it.each(['javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com/?secret=yes', 'http://untrusted.example'])('rejects unsafe configured origin %j', async origin => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    expect((await request()).status).toBe(503);
  });

  it('returns no document on database failure', async () => {
    db.single.mockResolvedValue({ data: fixture(), error: { code: '08000', message: 'PRIVATE-DB' } });
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE-DB');
    expect(console.warn).toHaveBeenCalledWith('invoice_pdf_unavailable', { reason: 'lookup_failed' });
  });

  it('uses a runtime override and refuses an absent origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect((await request()).status).toBe(503);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://build-time.example');
    vi.stubEnv('INVOICE_PUBLIC_ORIGIN', 'https://staging.example');
    const response = await request();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString('latin1')).toContain(`https://staging.example/now/${id}`);
  });

  it('renders real timestamp due dates and supported symbols in business names', async () => {
    // Migration20260304180000: due_date TIMESTAMPTZ, business_id -> businesses(id) PK.
    db.single.mockResolvedValue({ data: { ...fixture(), due_date: '2026-09-30T00:00:00+00:00', businesses: { name: 'A+B / 90\u00b0 Studio' } }, error: null });
    expect((await request()).status).toBe(200);
  });

  it.skipIf(!readerAvailable && !process.env.CI)('extracts real Unicode text, exact money, safe links and no private data', async () => {
    expect(readerAvailable, 'PDF content verification requires pdftotext (poppler-utils) in CI').toBe(true);
    db.single.mockResolvedValue({ data: { ...fixture(), businesses: { name: 'Nguy\u1ec5n H\u1eefu Ph\u00fac' }, status: 'paid' }, error: null });
    const response = await request();
    expect(response.status).toBe(200);
    const bytes = Buffer.from(await response.arrayBuffer());
    const extracted = spawnSync('pdftotext', ['-layout', '-', '-'], { input: bytes });
    expect(extracted.status).toBe(0);
    const text = extracted.stdout.toString();
    expect(text).toContain('Nguy\u1ec5n H\u1eefu Ph\u00fac');
    expect(text).toContain('40.00 USD');
    expect(text).toContain('PAID');
    expect(text).toContain('not a receipt');
    expect(text).toContain(`https://coinpayportal.com/now/${id}`);
    expect(text).not.toMatch(/PRIVATE|987654321|SECRET-FEE|hostile|Pay now/i);
  });

  it('wraps maximum supported labels within one page', async () => {
    db.single.mockResolvedValue({ data: { ...fixture(), invoice_number: 'W'.repeat(240), businesses: { name: 'W'.repeat(240) } }, error: null });
    const response = await request();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString('latin1')).toContain('/Count 1');
  });
});
