import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { putObject, getObject, deleteObject, sha256Hex } from './files';
import { audit } from './audit';

/**
 * Business documents CoinPay did not generate: a monthly spend report, an
 * accountant's workpapers, a tax notice. Stored encrypted on the files volume
 * (kind 'documents'), indexed in `finance_documents`, owned by the books' owner.
 */

export const DOCUMENT_CATEGORIES = ['report', 'statement', 'tax', 'invoice', 'other'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** upload: the PWA; api: a bearer client; fetch: the coinpay CLI fetcher; cloud: a CoinPay cloud fetch job. */
export const DOCUMENT_SOURCES = ['upload', 'api', 'fetch', 'cloud'] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const DOC_TYPES = ['notice', 'letter', 'transcript', 'form', 'return', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

const INSTITUTION_KEY = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** Normalise the optional tax fields a caller sent; anything malformed becomes null. */
export function taxFields(input: { institutionKey?: unknown; taxYear?: unknown; docType?: unknown }): {
  institution_key: string | null;
  tax_year: number | null;
  doc_type: DocType | null;
} {
  const key = typeof input.institutionKey === 'string' && INSTITUTION_KEY.test(input.institutionKey) ? input.institutionKey : null;
  const yearNumber = typeof input.taxYear === 'number' ? input.taxYear : typeof input.taxYear === 'string' && /^\d{4}$/.test(input.taxYear) ? Number(input.taxYear) : NaN;
  const year = Number.isInteger(yearNumber) && yearNumber >= 1990 && yearNumber <= 2100 ? yearNumber : null;
  const docType = (DOC_TYPES as readonly string[]).includes(String(input.docType)) ? (input.docType as DocType) : null;
  return { institution_key: key, tax_year: year, doc_type: docType };
}

/** What may be uploaded, by declared type and by the file's own first bytes. */
const ALLOWED: Record<string, { ext: string[]; magic?: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: ['pdf'], magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'text/csv': { ext: ['csv'] },
  'text/plain': { ext: ['txt', 'md'] },
  'image/png': { ext: ['png'], magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
};

export function maxDocumentBytes(): number {
  return Number(process.env.FINANCES_DOCUMENT_MAX_BYTES) || 25 * 1024 * 1024;
}

export class DocumentError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface DocumentRow {
  id: string;
  merchant_id: string;
  title: string;
  category: DocumentCategory;
  period_label: string | null;
  notes: string | null;
  original_filename: string | null;
  content_type: string;
  bytes: number;
  sha256: string;
  object_key: string;
  source: DocumentSource;
  institution_key: string | null;
  tax_year: number | null;
  doc_type: DocType | null;
  uploaded_by: string | null;
  created_at: string;
}

const COLUMNS =
  'id, merchant_id, title, category, period_label, notes, original_filename, content_type, bytes, sha256, object_key, source, institution_key, tax_year, doc_type, uploaded_by, created_at';

export function toPublicDocument(d: DocumentRow) {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    periodLabel: d.period_label,
    notes: d.notes,
    filename: d.original_filename,
    contentType: d.content_type,
    bytes: d.bytes,
    source: d.source,
    institutionKey: d.institution_key ?? null,
    taxYear: d.tax_year ?? null,
    docType: d.doc_type ?? null,
    uploadedBy: d.uploaded_by,
    createdAt: d.created_at,
    downloadUrl: `/api/finances/documents/${d.id}/download`,
  };
}

/** Resolve the content type from the declared type or the extension, then check the bytes. */
export function classifyUpload(declared: string, filename: string, bytes: Buffer): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  let type = ALLOWED[declared] ? declared : '';
  if (!type) type = Object.keys(ALLOWED).find((t) => ALLOWED[t].ext.includes(ext)) ?? '';
  if (!type) {
    throw new DocumentError('document_rejected', 'Upload a PDF, CSV, text, image, XLSX or DOCX file', 415);
  }
  const check = ALLOWED[type].magic;
  if (check && !check(bytes)) {
    throw new DocumentError('document_rejected', `The file does not look like a ${ext || type} file`, 415);
  }
  return type;
}

export async function createDocument(input: {
  merchantId: string;
  uploadedBy: string;
  title: string;
  category?: string | null;
  periodLabel?: string | null;
  notes?: string | null;
  filename: string | null;
  declaredType: string;
  bytes: Buffer;
  source?: DocumentSource;
  institutionKey?: string | null;
  taxYear?: number | string | null;
  docType?: string | null;
  /** Return the books owner's existing copy of the same file (by sha256) instead of storing it twice. */
  dedupe?: boolean;
}): Promise<DocumentRow & { duplicate?: boolean }> {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new DocumentError('invalid_request', 'A title is required');
  if (input.bytes.length === 0) throw new DocumentError('document_rejected', 'The file is empty');
  if (input.bytes.length > maxDocumentBytes()) {
    throw new DocumentError('document_rejected', `The file is larger than ${Math.floor(maxDocumentBytes() / (1024 * 1024))} MiB`, 413);
  }
  const category = (DOCUMENT_CATEGORIES as readonly string[]).includes(input.category ?? '')
    ? (input.category as DocumentCategory)
    : 'report';
  const contentType = classifyUpload(input.declaredType, input.filename ?? '', input.bytes);
  const source: DocumentSource = (DOCUMENT_SOURCES as readonly string[]).includes(input.source ?? '') ? (input.source as DocumentSource) : 'upload';
  const tax = taxFields(input);

  if (input.dedupe) {
    const existing = await findDocumentBySha(input.merchantId, sha256Hex(input.bytes));
    if (existing) return { ...existing, duplicate: true };
  }

  const stored = await putObject('documents', input.merchantId, input.bytes);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_documents')
    .insert({
      merchant_id: input.merchantId,
      title,
      category,
      period_label: input.periodLabel?.trim().slice(0, 60) || null,
      notes: input.notes?.trim().slice(0, 2000) || null,
      original_filename: input.filename?.slice(0, 255) || null,
      content_type: contentType,
      bytes: stored.bytes,
      sha256: stored.sha256,
      object_key: stored.objectKey,
      source,
      ...tax,
      uploaded_by: input.uploadedBy,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    await deleteObject(stored.objectKey).catch(() => undefined);
    // Two fetches racing on the same file: the unique (merchant_id, sha256) index kept one.
    if (input.dedupe && error?.code === '23505') {
      const existing = await findDocumentBySha(input.merchantId, stored.sha256);
      if (existing) return { ...existing, duplicate: true };
    }
    throw new Error(`Could not save the document: ${error?.message ?? 'no row'}`);
  }
  const meta: Record<string, string | number> = { category, bytes: stored.bytes };
  if (input.uploadedBy !== input.merchantId) meta.actor_id = input.uploadedBy;
  await audit(input.merchantId, 'document.upload', 'document', data.id, meta);
  return data as DocumentRow;
}

/** The books owner's copy of a file, by the sha256 of its plaintext. */
export async function findDocumentBySha(merchantId: string, sha256: string): Promise<DocumentRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('finance_documents')
    .select(COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('sha256', sha256)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not look up the document: ${error.message}`);
  return (data as DocumentRow | null) ?? null;
}

/** Every tax document the books owner holds (newest first), for the CPA pack. */
export async function listTaxDocuments(merchantId: string): Promise<DocumentRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('finance_documents')
    .select(COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('category', 'tax')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Could not list tax documents: ${error.message}`);
  return (data ?? []) as DocumentRow[];
}

export async function listDocuments(merchantId: string, { limit = 100, category = null }: { limit?: number; category?: DocumentCategory | null } = {}): Promise<DocumentRow[]> {
  let query = getSupabaseAdmin().from('finance_documents').select(COLUMNS).eq('merchant_id', merchantId);
  if (category) query = query.eq('category', category);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`Could not list documents: ${error.message}`);
  return (data ?? []) as DocumentRow[];
}

export async function getDocument(documentId: string, merchantId: string): Promise<DocumentRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('finance_documents')
    .select(COLUMNS)
    .eq('id', documentId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the document: ${error.message}`);
  return (data as DocumentRow | null) ?? null;
}

export async function readDocumentBytes(doc: DocumentRow): Promise<Buffer> {
  return getObject(doc.object_key);
}

export async function deleteDocument(documentId: string, merchantId: string, actorId: string): Promise<boolean> {
  const doc = await getDocument(documentId, merchantId);
  if (!doc) return false;
  const { error } = await getSupabaseAdmin()
    .from('finance_documents')
    .delete()
    .eq('id', documentId)
    .eq('merchant_id', merchantId);
  if (error) throw new Error(`Could not delete the document: ${error.message}`);
  await deleteObject(doc.object_key).catch(() => undefined);
  await audit(merchantId, 'document.delete', 'document', documentId, actorId !== merchantId ? { actor_id: actorId } : {});
  return true;
}
