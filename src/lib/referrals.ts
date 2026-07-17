import { createReferralsClient } from "@profullstack/stack/referrals";
import { createClient } from "@supabase/supabase-js";

export const referralStore = createReferralsClient({
  getClient: () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    ),
});
