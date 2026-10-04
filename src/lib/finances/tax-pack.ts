import 'server-only';
import { crc32 } from 'zlib';
import { listTaxDocuments, readDocumentBytes, type DocumentRow } from './documents';

/**
 * Tax documents beside the CPA pack: the notices, letters and transcripts in
 * the document library (category 'tax') that belong to the period, attached
 * to `books send` or zipped with `books export`, within the same 8 MiB the
 * email path allows. What does not fit is named, never silently dropped.
 */

export const TAX_PACK_MAX_BYTES = 8 * 1024 * 1024;

type TaxRow = Pick<DocumentRow, 'id' | 'title' | 'bytes' | 'tax_year' | 'period_label' | 'created_at' | 'original_filename'>;

/** The tax years a local date range touches: [startDate, endDate) as YYYY-MM-DD. */
export function taxYearsOf(startDate: string, endDate: string): { first: number; last: number } {
  const first = Number(startDate.slice(0, 4));
  const lastDay = new Date(`${endDate}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return { first, last: lastDay.getUTCFullYear() };
}

/**
 * Which tax documents belong to a period: by tax year when the fetcher read
 * one, else by the period label (a year or a notice date), else by the day the
 * document was added. Oldest tax year first.
 */
export function documentsForPeriod<T extends TaxRow>(rows: readonly T[], startDate: string, endDate: string): T[] {
  const { first, last } = taxYearsOf(startDate, endDate);
  const inYears = (year: number) => year >= first && year <= last;
  const inDates = (date: string) => date >= startDate && date < endDate;
  const picked = rows.filter((row) => {
    if (typeof row.tax_year === 'number') return inYears(row.tax_year);
    const label = (row.period_label ?? '').trim();
    if (/^\d{4}$/.test(label)) return inYears(Number(label));
    if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return inDates(label);
    return inDates(row.created_at.slice(0, 10));
  });
  return picked.sort((a, b) => (a.tax_year ?? 9999) - (b.tax_year ?? 9999) || a.created_at.localeCompare(b.created_at));
}

/**
 * Fill a byte budget in order, skipping (not stopping at) what does not fit,
 * so one large transcript does not keep every later letter out.
 */
export function fitAttachments<T extends { bytes: number }>(items: readonly T[], budget: number): { fit: T[]; skipped: T[] } {
  const fit: T[] = [];
  const skipped: T[] = [];
  let used = 0;
  for (const item of items) {
    if (used + item.bytes <= budget) {
      fit.push(item);
      used += item.bytes;
    } else skipped.push(item);
  }
  return { fit, skipped };
}

/** A file name for a document inside a pack: its own name, or its title, made safe and unique. */
export function packFilename(doc: TaxRow, taken: Set<string>): string {
  const base = (doc.original_filename || `${doc.title}.pdf`)
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'tax-document.pdf';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '.pdf';
  let name = `${stem}${ext}`;
  for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${stem}-${i}${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

export interface TaxAttachment {
  id: string;
  title: string;
  filename: string;
  content: Buffer;
}

export interface TaxAttachmentPlan {
  attached: TaxAttachment[];
  skipped: Array<{ id: string; title: string; bytes: number; reason: string }>;
}

/** The period's tax documents that fit in `budget` bytes, read and decrypted, plus what was left out. */
export async function taxAttachmentsFor(merchantId: string, startDate: string, endDate: string, budget: number): Promise<TaxAttachmentPlan> {
  const rows = documentsForPeriod(await listTaxDocuments(merchantId), startDate, endDate);
  const { fit, skipped } = fitAttachments(rows, Math.max(0, budget));
  const taken = new Set<string>();
  const attached: TaxAttachment[] = [];
  for (const doc of fit) attached.push({ id: doc.id, title: doc.title, filename: packFilename(doc, taken), content: await readDocumentBytes(doc) });
  return {
    attached,
    skipped: skipped.map((doc) => ({ id: doc.id, title: doc.title, bytes: doc.bytes, reason: `${(doc.bytes / (1024 * 1024)).toFixed(1)} MiB does not fit in the 8 MiB limit` })),
  };
}

// ---------------------------------------------------------------------------
// A stored (uncompressed) ZIP: PDFs are already compressed, and this keeps the
// pack dependency-free. Names are UTF-8 (general purpose flag bit 11).
// ---------------------------------------------------------------------------

export function zipStore(files: ReadonlyArray<{ name: string; content: Buffer }>, date: Date = new Date()): Buffer {
  const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const dosDate = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.content) >>> 0;
    const size = file.content.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, file.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + size;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** The pack's MANIFEST.txt: what is inside, and what was left out and why. */
export function packManifest(label: string, booksFile: string, plan: TaxAttachmentPlan): string {
  const lines = [
    `CoinPay CPA pack: ${label}`,
    '',
    `Books: ${booksFile}`,
    '',
    `Tax documents included (${plan.attached.length}):`,
    ...(plan.attached.length ? plan.attached.map((a) => `  ${a.filename}  (${a.title})`) : ['  none']),
  ];
  if (plan.skipped.length) {
    lines.push('', `Tax documents left out to stay under 8 MiB (${plan.skipped.length}); download them from CoinPay under Finances > Documents:`);
    for (const s of plan.skipped) lines.push(`  ${s.title}  (${s.reason})`);
  }
  lines.push('', 'Tax categories in the books are a bookkeeping mapping prepared for an accountant, not tax advice.', '');
  return lines.join('\n');
}
