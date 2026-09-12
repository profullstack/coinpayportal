import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { bulkReview, BooksError } from '@/lib/finances/books';
import { financeError, financeErrorFromException, financeJson, isUuid, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/books/bulk — confirm many rows at once.
 * Body: `{ ids: [...], category?, taxCategory?, scope?, createRule? }`.
 * Omitting category/taxCategory confirms each row's current suggestion.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const body = await readJsonBody<{ ids?: unknown; category?: unknown; taxCategory?: unknown; scope?: unknown; createRule?: unknown }>(req);
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => isUuid(v)) : [];
  if (ids.length === 0) return financeError('invalid_request', 'ids must be a list of transaction uuids', 400);
  if (ids.length > 500) return financeError('invalid_request', 'At most 500 rows per request', 400);
  if (body.scope !== undefined && body.scope !== null && body.scope !== 'business' && body.scope !== 'personal') {
    return financeError('invalid_request', 'scope must be business or personal', 400);
  }
  try {
    const reviewed = await bulkReview(guard.id, ids, {
      category: body.category === undefined ? undefined : typeof body.category === 'string' ? body.category : null,
      taxCategory: body.taxCategory === undefined ? undefined : typeof body.taxCategory === 'string' ? body.taxCategory : null,
      scope: body.scope === undefined ? undefined : (body.scope as 'business' | 'personal' | null),
      createRule: body.createRule === true,
    });
    return financeJson({ reviewed });
  } catch (err) {
    if (err instanceof BooksError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not save the reviews');
  }
}
