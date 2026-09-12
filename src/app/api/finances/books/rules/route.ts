import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { listRules, createRule, BooksError } from '@/lib/finances/books';
import { financeError, financeErrorFromException, financeJson, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** GET /api/finances/books/rules — this merchant's category rules. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  try {
    return financeJson({ rules: await listRules(guard.id) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not list rules');
  }
}

/**
 * POST /api/finances/books/rules — add or replace a rule.
 * Body: `{ matchField: "payee"|"description", matchType: "exact"|"contains",
 * pattern, category, taxCategory?, scope? }`.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const body = await readJsonBody<{ matchField?: unknown; matchType?: unknown; pattern?: unknown; category?: unknown; taxCategory?: unknown; scope?: unknown }>(req);
  const matchField = body.matchField === 'description' ? 'description' : 'payee';
  const matchType = body.matchType === 'contains' ? 'contains' : 'exact';
  if (typeof body.pattern !== 'string' || typeof body.category !== 'string') {
    return financeError('invalid_request', 'pattern and category are required', 400);
  }
  if (body.scope !== undefined && body.scope !== null && body.scope !== 'business' && body.scope !== 'personal') {
    return financeError('invalid_request', 'scope must be business or personal', 400);
  }
  try {
    const rule = await createRule(guard.id, {
      matchField,
      matchType,
      pattern: body.pattern,
      category: body.category,
      taxCategory: typeof body.taxCategory === 'string' ? body.taxCategory : null,
      scope: (body.scope as 'business' | 'personal' | null | undefined) ?? null,
    });
    return financeJson({ rule }, 201);
  } catch (err) {
    if (err instanceof BooksError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not save the rule');
  }
}
