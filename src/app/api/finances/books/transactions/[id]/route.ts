import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { reviewTransaction, toPublicRow, BooksError } from '@/lib/finances/books';
import { financeError, financeErrorFromException, financeJson, isUuid, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/finances/books/transactions/[id] — confirm a row's category,
 * tax category and scope. Body: `{ category?, taxCategory?, scope?, note?,
 * createRule? }`. Marks the row reviewed; with `createRule` the payee
 * becomes a rule so future syncs agree.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Transaction not found', 404);
  const body = await readJsonBody<{ category?: unknown; taxCategory?: unknown; scope?: unknown; note?: unknown; createRule?: unknown }>(req);
  if (body.scope !== undefined && body.scope !== null && body.scope !== 'business' && body.scope !== 'personal') {
    return financeError('invalid_request', 'scope must be business or personal', 400);
  }
  try {
    const row = await reviewTransaction(guard.id, id, {
      category: body.category === undefined ? undefined : typeof body.category === 'string' ? body.category : null,
      taxCategory: body.taxCategory === undefined ? undefined : typeof body.taxCategory === 'string' ? body.taxCategory : null,
      scope: body.scope === undefined ? undefined : (body.scope as 'business' | 'personal' | null),
      note: body.note === undefined ? undefined : typeof body.note === 'string' ? body.note : null,
      createRule: body.createRule === true,
    });
    return financeJson({ transaction: toPublicRow(row) });
  } catch (err) {
    if (err instanceof BooksError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not save the review');
  }
}
