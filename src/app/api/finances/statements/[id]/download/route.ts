import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { getStatement, readStatementBytes, StatementError } from '@/lib/finances/statements';
import { financeError, financeErrorFromException, isUuid } from '@/lib/finances/api';
import { audit } from '@/lib/finances/audit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/statements/[id]/download — the original bytes, as an
 * attachment. Ownership is rechecked; the hash is verified; nothing is
 * embedded inline and nothing is cached.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Statement not found', 404);
  try {
    const statement = await getStatement(id, guard.id);
    if (!statement) return financeError('not_found', 'Statement not found', 404);
    const { bytes, filename } = await readStatementBytes(statement);
    await audit(guard.id, 'statement.download', 'statement', statement.id, { bytes: bytes.length });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-SHA256': statement.content_hash,
        'X-Provenance': 'user_supplied',
      },
    });
  } catch (err) {
    if (err instanceof StatementError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not download the statement');
  }
}
