import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('./files', () => ({ putObject: vi.fn(), getObject: vi.fn(), deleteObject: vi.fn() }));
vi.mock('./audit', () => ({ audit: vi.fn() }));

import { classifyUpload, DocumentError } from './documents';

const pdf = Buffer.from('%PDF-1.7\n...');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe('classifyUpload', () => {
  it('accepts a real PDF by declared type or by extension', () => {
    expect(classifyUpload('application/pdf', 'report.pdf', pdf)).toBe('application/pdf');
    expect(classifyUpload('', 'report.pdf', pdf)).toBe('application/pdf');
    expect(classifyUpload('application/octet-stream', 'report.PDF', pdf)).toBe('application/pdf');
  });

  it('refuses a file whose bytes do not match its claimed type', () => {
    expect(() => classifyUpload('application/pdf', 'evil.pdf', Buffer.from('MZ\x90\x00'))).toThrow(DocumentError);
    expect(() => classifyUpload('image/png', 'x.png', pdf)).toThrow(DocumentError);
  });

  it('refuses types outside the allow list', () => {
    expect(() => classifyUpload('text/html', 'page.html', Buffer.from('<html>'))).toThrow(/Upload a PDF/);
    expect(() => classifyUpload('application/x-msdownload', 'app.exe', Buffer.from('MZ'))).toThrow(DocumentError);
  });

  it('accepts CSV and images', () => {
    expect(classifyUpload('text/csv', 'ledger.csv', Buffer.from('a,b\n1,2'))).toBe('text/csv');
    expect(classifyUpload('', 'scan.png', png)).toBe('image/png');
  });
});
