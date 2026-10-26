import type { SupabaseClient } from '@supabase/supabase-js';
import { createProfileStore, type ProfileStore } from '@profullstack/profile';

/**
 * The shared @profullstack/profile fields (email, first_name, last_name,
 * company_domain, job_title, linkedin_url) live in public.user_profiles keyed
 * by merchants.id. Server-only: the table has RLS on and no anon/authenticated
 * policies, so it is reached with the service-role client.
 */
export function profileStore(supabase: SupabaseClient): ProfileStore {
  return createProfileStore(supabase, { table: 'user_profiles', key: 'user_id' });
}
