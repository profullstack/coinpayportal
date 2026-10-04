import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { createDocument, listDocuments, toPublicDocument, maxDocumentBytes, DocumentError, DOCUMENT_CATEGORIES, type DocumentCategory } from '@/lib/finances/documents';
import { financeError, financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/finances/documents[?category=tax&limit=n] — the document library, newest first. */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const categoryParam = req.nextUrl.searchParams.get('category');
  const category = (DOCUMENT_CATEGORIES as readonly string[]).find((c) => c === categoryParam) as DocumentCategory | undefined;
  if (categoryParam && !category) return financeError('invalid_request', `category must be one of ${DOCUMENT_CATEGORIES.join(', ')}`, 400);
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100');
  try {
    const docs = await listDocuments(guard.id, { category: category ?? null, limit: Number.isInteger(limit) ? limit : 100 });
    return financeJson({ documents: docs.map(toPublicDocument) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not list documents');
  }
}

/**
 * POST /api/finances/documents — add a business document (admin+ on the books).
 *
 * Multipart form: `file` (PDF, CSV, text, image, XLSX, DOCX), `title`, and
 * optional `category` (report|statement|tax|invoice|other), `period`, `notes`.
 * Stored encrypted as supplied; nothing is read out of it.
 *
 * The CLI statement fetcher also sends `source=fetch`, `institutionKey`
 * (ftb, irs, …), `taxYear` and `docType`; such a file is kept once per books
 * owner, and a repeat answers 200 with `duplicate: true` and the stored copy.
 */
export async function POST(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.manage', { write: true });
  if (guard instanceof NextResponse) return guard;

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxDocumentBytes() + 64 * 1024) {
    return financeError('document_rejected', `The upload is larger than ${Math.floor(maxDocumentBytes() / (1024 * 1024))} MiB`, 413);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return financeError('invalid_request', 'Expected a multipart form with a file', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return financeError('invalid_request', 'A file is required in the "file" field', 400);
  const str = (name: string): string | null => {
    const v = form.get(name);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const usedBearer = /^bearer\s/i.test(req.headers.get('authorization') ?? '') && !req.headers.get('sec-fetch-site');
  // The CLI's statement fetcher says so (`source=fetch`); only a bearer client may.
  const fetched = usedBearer && str('source') === 'fetch';

  try {
    const doc = await createDocument({
      merchantId: guard.id,
      uploadedBy: guard.actorId,
      title: str('title') ?? file.name ?? 'Untitled',
      category: str('category'),
      periodLabel: str('period'),
      notes: str('notes'),
      filename: file.name || null,
      declaredType: file.type || '',
      bytes: Buffer.from(await file.arrayBuffer()),
      source: fetched ? 'fetch' : usedBearer ? 'api' : 'upload',
      institutionKey: str('institutionKey'),
      taxYear: str('taxYear'),
      docType: str('docType'),
      // A fetched file is kept once per books owner; the fetcher sees `duplicate`.
      dedupe: fetched,
    });
    return financeJson({ document: toPublicDocument(doc), duplicate: doc.duplicate === true }, doc.duplicate ? 200 : 201);
  } catch (err) {
    if (err instanceof DocumentError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not save the document');
  }
}
