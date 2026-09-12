import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { listQueue, toPublicRow, SPEND_CATEGORIES } from '@/lib/finances/books';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '@/lib/finances/tax';
import { isModelCategorizationEnabled } from '@/lib/finances/categorize-model';
import { financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/books/queue — transactions awaiting review (default),
 * or reviewed/all, with the category vocabularies the UI needs.
 * Filters: `status`, `account`, `scope`, `start`, `end`, `search`, `limit`, `offset`.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const q = req.nextUrl.searchParams;
  const status = q.get('status');
  const scope = q.get('scope');
  try {
    const page = await listQueue(guard.id, {
      status: status === 'reviewed' || status === 'all' ? status : 'unreviewed',
      accountId: q.get('account'),
      scope: scope === 'business' || scope === 'personal' ? scope : 'all',
      start: q.get('start'),
      end: q.get('end'),
      search: q.get('search'),
      limit: Number.parseInt(q.get('limit') ?? '50', 10) || 50,
      offset: Number.parseInt(q.get('offset') ?? '0', 10) || 0,
    });
    return financeJson({
      rows: page.rows.map(toPublicRow),
      total: page.total,
      unreviewed: page.unreviewed,
      categories: SPEND_CATEGORIES,
      taxCategories: TAX_CATEGORIES.map((id) => ({ id, label: TAX_CATEGORY_LABELS[id] })),
      modelEnabled: isModelCategorizationEnabled(),
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not load the review queue');
  }
}
