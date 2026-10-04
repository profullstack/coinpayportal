import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { jsPDF } from 'jspdf';
import { z } from 'zod';

export const PUBLIC_INVOICE_PDF_FIELDS = 'invoice_number,status,currency,amount,due_date,created_at,businesses(name)';
export const PUBLIC_INVOICE_STATUSES = ['sent', 'overdue', 'paid'] as const;
export const invoicePdfId = z.string().uuid();

type PdfFailure = 'lookup_failed' | 'invalid_snapshot' | 'invalid_origin' | 'font_unavailable' | 'font_incompatible' | 'unsupported_text' | 'layout_overflow';
export class InvoicePdfError extends Error {
  constructor(readonly reason: PdfFailure) { super(reason); }
}
let fontData: Promise<string> | undefined;
function loadFont(): Promise<string> {
  fontData ??= readFile(path.join(process.cwd(), 'public/fonts/invoices/NotoSans-Regular.ttf'))
    .then(bytes => bytes.toString('base64')).catch(() => {
      fontData = undefined;
      throw new InvoicePdfError('font_unavailable');
    });
  return fontData;
}

const label = z.string().min(1).max(240).transform(value => value.normalize('NFC'))
  .refine(value => value.trim().length > 0 && /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{M}\p{N}\p{P}\p{Zs}\p{S}]+$/u.test(value));
const date = z.string().datetime({ offset: true });
const schema = z.object({
  invoice_number: label,
  status: z.enum(PUBLIC_INVOICE_STATUSES),
  currency: z.string().refine(value => Intl.supportedValuesOf('currency').includes(value)),
  // Do not round corrupt values or unsafe JSON numbers into plausible money.
  amount: z.union([z.string(), z.number()]).transform(String)
    .refine(value => /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value) && Number(value) > 0),
  due_date: date.nullable(),
  created_at: date,
  businesses: z.object({ name: label }),
});

export function invoiceSnapshot(input: unknown) {
  // Zod strips every unlisted field, including fields on the business object.
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new InvoicePdfError('invalid_snapshot');
  return parsed.data;
}

export function invoiceSnapshotLink(id: string): string {
  invoicePdfId.parse(id);
  const origin = process.env.INVOICE_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_APP_URL;
  if (!origin) throw new InvoicePdfError('invalid_origin');
  let base: URL;
  try { base = new URL(origin); } catch { throw new InvoicePdfError('invalid_origin'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) ||
      base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (local && process.env.NODE_ENV === 'production')) {
    throw new InvoicePdfError('invalid_origin');
  }
  return new URL(`/now/${id}`, base).href;
}

export async function renderInvoiceSnapshot(input: unknown, id: string, generatedAt = new Date()): Promise<ArrayBuffer> {
  const invoice = invoiceSnapshot(input);
  const liveUrl = invoiceSnapshotLink(id);
  if (liveUrl.length > 240) throw new InvoicePdfError('invalid_origin');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  // Bundled, licensed font only: no remote fonts, images, HTML or user file paths.
  doc.addFileToVFS('NotoSans-Regular.ttf', await loadFont());
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.setFont('NotoSans');
  doc.setProperties({ title: 'Invoice snapshot', author: 'CoinPay', subject: 'Public invoice snapshot' });
  doc.setCreationDate(generatedAt);

  const metadata = doc.getFont().metadata as { characterToGlyph?: (code: number) => number };
  if (typeof metadata.characterToGlyph !== 'function') throw new InvoicePdfError('font_incompatible');
  const draw = (text: string, y: number, size = 11) => {
    for (const char of text) {
      if (!metadata.characterToGlyph?.(char.codePointAt(0)!)) throw new InvoicePdfError('unsupported_text');
    }
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, 170) as string[];
    const lineHeight = size * 25.4 / 72 * 1.35;
    if (lines.length > 6 || y + lines.length * lineHeight > 265) throw new InvoicePdfError('layout_overflow');
    doc.text(lines, 20, y, { lineHeightFactor: 1.35 });
    return y + lines.length * lineHeight + 5;
  };

  let y = draw('Invoice snapshot', 24, 22);
  y = draw(`Invoice: ${invoice.invoice_number}`, y);
  y = draw(`Issuer: ${invoice.businesses.name}`, y);
  y = draw(`Status: ${invoice.status.toUpperCase()}`, y);
  const [whole, fraction = ''] = invoice.amount.split('.');
  y = draw(`Invoice total: ${whole}.${fraction.padEnd(2, '0')} ${invoice.currency}`, y, 16);
  y = draw(`Created (UTC): ${new Date(invoice.created_at).toISOString().slice(0, 10)}`, y);
  if (invoice.due_date) y = draw(`Due (UTC): ${new Date(invoice.due_date).toISOString().slice(0, 10)}`, y);
  y = draw(`Generated (UTC): ${generatedAt.toISOString()}`, y);
  y = draw('This snapshot is not a receipt or proof of settlement. Status may change after download.', y);
  y = draw('Open the live invoice for current status and available payment options.', y);
  const linkY = y;
  y = draw(liveUrl, y, 10);
  doc.link(20, linkY - 4, 170, y - linkY, { url: liveUrl });
  if (doc.getNumberOfPages() !== 1) throw new InvoicePdfError('layout_overflow');
  return doc.output('arraybuffer');
}
