import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { lockOperatorKeys } from '@/lib/wallets/operator-keys';

/** POST /api/admin/operator-vault/lock: forget the operator keys now. Forwarding pauses. */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const wasUnlocked = lockOperatorKeys();
  console.log(`[operator-vault] locked by admin ${guard.id}`);
  return NextResponse.json({ success: true, unlocked: false, wasUnlocked });
}
