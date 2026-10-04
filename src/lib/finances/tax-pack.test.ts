import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crc32 } from 'zlib';

vi.mock('server-only', () => ({}));
const docs = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, bytes: new Map<string, Buffer>() }));
vi.mock('./documents', () => ({
  listTaxDocuments: vi.fn(async () => docs.rows),
  readDocumentBytes: vi.fn(async (doc: { id: string }) => docs.bytes.get(doc.id) ?? Buffer.alloc(0)),
}));

import { documentsForPeriod, fitAttachments, packFilename, packManifest, taxAttachmentsFor, taxYearsOf, TAX_PACK_MAX_BYTES, zipStore } from './tax-pack';

const MiB = 1024 * 1024;
const row = (id: string, over: Record<string, unknown>) => ({
  id,
  title: `Doc ${id}`,
  bytes: 1000,
  tax_year: null,
  period_label: null,
  created_at: '2026-02-01T00:00:00Z',
  original_filename: `${id}.pdf`,
  ...over,
});

describe('which tax documents belong to a period', () => {
  it('reads the years a local date range touches', () => {
    expect(taxYearsOf('2025-01-01', '2026-01-01')).toEqual({ first: 2025, last: 2025 });
    expect(taxYearsOf('2025-07-01', '2026-07-01')).toEqual({ first: 2025, last: 2026 });
  });

  it('by tax year, else period label, else the day it was added', () => {
    const rows = [
      row('ty2025', { tax_year: 2025 }),
      row('ty2024', { tax_year: 2024 }),
      row('label-year', { period_label: '2025' }),
      row('notice-date-in', { period_label: '2025-03-14' }),
      row('notice-date-out', { period_label: '2026-03-14' }),
      row('added-in', { created_at: '2025-06-01T00:00:00Z' }),
      row('added-out', { created_at: '2026-02-01T00:00:00Z' }),
    ];
    expect(documentsForPeriod(rows, '2025-01-01', '2026-01-01').map((r) => r.id)).toEqual(['ty2025', 'added-in', 'label-year', 'notice-date-in']);
  });
});

describe('the 8 MiB cap', () => {
  it('skips what does not fit and keeps going', () => {
    const items = [{ id: 'a', bytes: 5 * MiB }, { id: 'b', bytes: 4 * MiB }, { id: 'c', bytes: 2 * MiB }];
    const { fit, skipped } = fitAttachments(items, 8 * MiB);
    expect(fit.map((i) => i.id)).toEqual(['a', 'c']);
    expect(skipped.map((i) => i.id)).toEqual(['b']);
  });

  it('attaches the period documents that fit beside the books file, and names the rest', async () => {
    docs.rows = [row('n1', { tax_year: 2025, bytes: 3 * MiB, title: 'Notice of Proposed Assessment' }), row('t1', { tax_year: 2025, bytes: 6 * MiB, title: 'Account Transcript' }), row('old', { tax_year: 2023 })];
    docs.bytes = new Map([['n1', Buffer.from('%PDF-n1')]]);
    const booksFile = 2 * MiB;
    const plan = await taxAttachmentsFor('m-1', '2025-01-01', '2026-01-01', TAX_PACK_MAX_BYTES - booksFile);
    expect(plan.attached.map((a) => a.title)).toEqual(['Notice of Proposed Assessment']);
    expect(plan.attached[0].content.toString()).toBe('%PDF-n1');
    expect(plan.skipped).toEqual([expect.objectContaining({ title: 'Account Transcript', reason: expect.stringMatching(/does not fit in the 8 MiB limit/) })]);
    const manifest = packManifest('2025', 'books.csv', plan);
    expect(manifest).toContain('Notice of Proposed Assessment');
    expect(manifest).toMatch(/left out to stay under 8 MiB \(1\)[\s\S]*Account Transcript/);
  });

  beforeEach(() => {
    docs.rows = [];
    docs.bytes = new Map();
  });
});

describe('pack file names and the stored ZIP', () => {
  it('makes names safe and unique', () => {
    const taken = new Set<string>();
    expect(packFilename(row('x', { original_filename: 'a/b:c.pdf' }) as never, taken)).toBe('a-b-c.pdf');
    expect(packFilename(row('y', { original_filename: 'a/b:c.pdf' }) as never, taken)).toBe('a-b-c-2.pdf');
    expect(packFilename(row('z', { original_filename: null, title: 'Letter 0000' }) as never, taken)).toBe('Letter 0000.pdf');
  });

  it('writes a ZIP whose directory and checksums are right', () => {
    const files = [
      { name: 'books.csv', content: Buffer.from('a,b\n1,2\n') },
      { name: 'tax-documents/notice.pdf', content: Buffer.from('%PDF-1.4 fake') },
    ];
    const zip = zipStore(files, new Date(2026, 9, 4, 12, 0, 0));
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(2);
    let at = zip.readUInt32LE(end + 16);
    for (const file of files) {
      expect(zip.readUInt32LE(at)).toBe(0x02014b50);
      const size = zip.readUInt32LE(at + 20);
      const nameLength = zip.readUInt16LE(at + 28);
      const offset = zip.readUInt32LE(at + 42);
      expect(zip.subarray(at + 46, at + 46 + nameLength).toString()).toBe(file.name);
      expect(zip.readUInt32LE(at + 16)).toBe(crc32(file.content) >>> 0);
      const dataStart = offset + 30 + zip.readUInt16LE(offset + 26);
      expect(zip.subarray(dataStart, dataStart + size).equals(file.content)).toBe(true);
      at += 46 + nameLength;
    }
  });
});
