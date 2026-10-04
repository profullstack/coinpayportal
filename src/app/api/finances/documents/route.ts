import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { createDocument, listDocuments, toPublicDocument, maxDocumentBytes, DocumentError } from '@/lib/finances/documents';
import { financeError, financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/finances/documents — the uploaded document library. */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  try {
    const docs = await listDocuments(guard.id);
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
      source: usedBearer ? 'api' : 'upload',
    });
    return financeJson({ document: toPublicDocument(doc) }, 201);
  } catch (err) {
    if (err instanceof DocumentError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not save the document');
  }
}
