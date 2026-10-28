import { NextRequest, NextResponse } from 'next/server';
import { lockVault } from '@/lib/vault/vault-service';
import { vaultMerchant } from '@/lib/vault/route-auth';

/** POST /api/vault/lock: drop this merchant's unlock now. Jobs that need it pause. */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const who = await vaultMerchant(request);
  if (who instanceof NextResponse) return who;
  const wasUnlocked = lockVault('merchant', who.merchantId);
  return NextResponse.json({ success: true, unlocked: false, wasUnlocked });
}
