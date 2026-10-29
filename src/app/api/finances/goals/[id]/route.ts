import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { financeError, financeErrorFromException, financeJson, readJsonBody } from '@/lib/finances/api';
import { GoalError } from '@/lib/finances/goals';
import { deleteGoal, goalsWithProgress, listContributions, updateGoal, goalsTimezone } from '@/lib/finances/goals-store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/finances/goals/{id} — one goal with its progress and contributions. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    const timezone = await goalsTimezone(guard.id, req.nextUrl.searchParams.get('timezone'));
    const goal = (await goalsWithProgress(guard.id, timezone, { includeArchived: true })).find((g) => g.id === id);
    if (!goal) return financeError('not_found', 'Goal not found', 404);
    return financeJson({ goal, contributions: await listContributions(guard.id, id) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not load the goal');
  }
}

/**
 * PATCH /api/finances/goals/{id} — change any field of the create body, plus
 * `archived: true|false` and `startProgress` (where on-track is measured from).
 * An archived goal is left out of GET /goals (unless `?archived=1`), the
 * report and the goals email. Changing the linked accounts, wallets, kind,
 * start or target re-reads `startProgress` from the new set unless it is given.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const body = await readJsonBody<Record<string, unknown>>(req);
  try {
    const updated = await updateGoal(guard.id, id, body);
    if (!updated) return financeError('not_found', 'Goal not found', 404);
    const timezone = await goalsTimezone(guard.id, req.nextUrl.searchParams.get('timezone'));
    const goal = (await goalsWithProgress(guard.id, timezone, { includeArchived: true })).find((g) => g.id === id);
    return financeJson({ goal });
  } catch (err) {
    if (err instanceof GoalError) return financeError('invalid_request', err.message, 400);
    return financeErrorFromException(err, 'Could not update the goal');
  }
}

/** DELETE /api/finances/goals/{id} — delete the goal and its contributions. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    const removed = await deleteGoal(guard.id, id);
    if (!removed) return financeError('not_found', 'Goal not found', 404);
    return financeJson({ success: true });
  } catch (err) {
    return financeErrorFromException(err, 'Could not delete the goal');
  }
}
