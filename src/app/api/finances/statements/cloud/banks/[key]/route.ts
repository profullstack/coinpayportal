import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { disconnectBankSession, getBankSession, toPublicSession, updateBankSession } from '@/lib/finances/bank-sessions';
import { cloudError, INSTITUTION_KEY } from '@/lib/finances/cloud-api';
import { financeError, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** PATCH /api/finances/statements/cloud/banks/:key — `{schedule?: "weekly" | "off", keepalive?: boolean}`. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { key } = await params;
  if (!INSTITUTION_KEY.test(key)) return financeError('not_found', 'Bank not found', 404);
  let body: { schedule?: unknown; keepalive?: unknown };
  try {
    body = await req.json();
  } catch {
    return financeError('invalid_request', 'Expected a JSON body', 400);
  }
  const schedule = body.schedule;
  const keepalive = body.keepalive;
  if (schedule === undefined && keepalive === undefined) return financeError('invalid_request', 'Pass schedule (weekly | off) and/or keepalive (true | false)', 400);
  if (schedule !== undefined && schedule !== 'weekly' && schedule !== 'off') return financeError('invalid_request', 'schedule must be weekly or off', 400);
  if (keepalive !== undefined && typeof keepalive !== 'boolean') return financeError('invalid_request', 'keepalive must be true or false', 400);
  try {
    const row = await getBankSession(guard.id, key);
    if (!row) return financeError('not_found', `${key} is not connected to CoinPay cloud`, 404);
    await updateBankSession(guard.id, key, {
      ...(schedule !== undefined ? { schedule: schedule as 'weekly' | 'off' } : {}),
      ...(schedule === 'weekly' && !row.next_fetch_at ? { next_fetch_at: new Date().toISOString() } : {}),
      ...(typeof keepalive === 'boolean' ? { keepalive, ...(keepalive ? { next_touch_at: new Date().toISOString() } : {}) } : {}),
    });
    const updated = await getBankSession(guard.id, key);
    return financeJson({ bank: updated ? toPublicSession(updated) : null });
  } catch (err) {
    return cloudError(err, 'Could not update the schedule');
  }
}

/**
 * DELETE /api/finances/statements/cloud/banks/:key — forget the saved bank
 * session at once. Statements already imported stay in the library.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { key } = await params;
  if (!INSTITUTION_KEY.test(key)) return financeError('not_found', 'Bank not found', 404);
  try {
    const removed = await disconnectBankSession(guard, key);
    if (!removed) return financeError('not_found', `${key} is not connected to CoinPay cloud`, 404);
    return financeJson({ disconnected: key, note: 'The saved bank session was deleted. Imported statements were kept.' });
  } catch (err) {
    return cloudError(err, 'Could not disconnect');
  }
}
