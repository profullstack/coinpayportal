import type { NextRequest } from 'next/server';
import { createProfileHandlers } from '@profullstack/profile';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveMerchant } from '@/lib/auth/merchant';
import { profileStore } from '@/lib/profile';

export const dynamic = 'force-dynamic';

// GET / PUT / PATCH /api/v1/me/profile: the signed-in merchant's
// @profullstack/profile fields. Dashboard session only: a business API key is
// handed to integrators and never reads or writes the owner's contact details.
const handlers = () => {
  const supabase = getSupabaseAdmin();
  return createProfileHandlers({
    store: profileStore(supabase),
    getUser: async (req: Request) => {
      const resolved = await resolveMerchant(supabase, req as NextRequest);
      if ('error' in resolved || resolved.via !== 'session') return null;
      const { data } = await supabase
        .from('merchants')
        .select('email')
        .eq('id', resolved.merchantId)
        .maybeSingle();
      return { id: resolved.merchantId, email: data?.email ?? null };
    },
  });
};

export const GET = (req: NextRequest) => handlers().GET(req);
export const PUT = (req: NextRequest) => handlers().PUT(req);
export const PATCH = (req: NextRequest) => handlers().PATCH(req);
