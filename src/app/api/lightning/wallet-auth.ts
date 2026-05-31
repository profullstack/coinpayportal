import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { WalletErrors } from '@/lib/web-wallet/response';

export async function authorizeWalletRequest(
  supabase: SupabaseClient,
  request: NextRequest,
  walletId: string,
  body?: string
) {
  const auth = await authenticateWalletRequest(
    supabase,
    request.headers.get('authorization'),
    request.method,
    request.nextUrl.pathname,
    body
  );

  if (!auth.success) {
    return WalletErrors.unauthorized(auth.error);
  }

  if (auth.walletId !== walletId) {
    return WalletErrors.forbidden('Cannot access another wallet');
  }

  return null;
}
