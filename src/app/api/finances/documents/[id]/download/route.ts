import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { getDocument, readDocumentBytes } from '@/lib/finances/documents';
import { auditFinance } from '@/lib/finances/audit';
import { financeError, financeErrorFromException, isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 150) || 'document';
}

/** GET /api/finances/documents/[id]/download — the stored bytes, as supplied. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('invalid_request', 'Unknown document', 400);
  try {
    const doc = await getDocument(id, guard.id);
    if (!doc) return financeError('not_found', 'Document not found', 404);
    const bytes = await readDocumentBytes(doc);
    await auditFinance(guard, 'document.download', 'document', doc.id, { bytes: bytes.length });
    const filename = safeFilename(doc.original_filename ?? `${doc.title}`);
    // Inline only for PDFs and images; everything else downloads.
    const inline = doc.content_type === 'application/pdf' || doc.content_type.startsWith('image/');
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': doc.content_type,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not read the document');
  }
}
