/**
 * App-layer authorization for team members.
 *
 * Resolves the *effective* role a logged-in merchant has on a given business or
 * organization, then gates actions via `can()` from ./permissions. All queries use the
 * service-role Supabase client (RLS is bypassed), so THIS is the security boundary —
 * routes must call `authorizeBusiness` / `authorizeOrg` instead of the legacy
 * `.eq('merchant_id', userId)` ownership check.
 *
 * Effective role = the HIGHEST-privilege membership the user holds for the resource:
 *   - the business's actual owner (businesses.merchant_id) is always `owner`;
 *   - a direct row in business_members for that business;
 *   - a row in organization_members for the business's organization (org role applies
 *     to every business in the org).
 * A business belongs to at most one organization (businesses.organization_id), so the
 * org role maps unambiguously.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { type Role, type Capability, can, ROLE_RANK } from './permissions';

export type AuthzOk = { ok: true; role: Role };
export type AuthzErr = { ok: false; status: 403 | 404; error: string };
export type AuthzResult = AuthzOk | AuthzErr;

function maxRole(a: Role | null, b: Role | null): Role | null {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/** Resolve a merchant's effective role for a business, or null if no access. */
export async function resolveBusinessRole(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
): Promise<Role | null> {
  const { data: business } = await supabase
    .from('businesses')
    .select('merchant_id, organization_id')
    .eq('id', businessId)
    .maybeSingle();

  if (!business) return null;
  if (business.merchant_id === userId) return 'owner';

  const { data: bm } = await supabase
    .from('business_members')
    .select('role')
    .eq('business_id', businessId)
    .eq('merchant_id', userId)
    .maybeSingle();

  let orgRole: Role | null = null;
  if (business.organization_id) {
    const { data: om } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', business.organization_id)
      .eq('merchant_id', userId)
      .maybeSingle();
    orgRole = (om?.role as Role) ?? null;
  }

  return maxRole((bm?.role as Role) ?? null, orgRole);
}

/** Resolve a merchant's effective role for an organization, or null if no access. */
export async function resolveOrgRole(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<Role | null> {
  const { data: org } = await supabase
    .from('organizations')
    .select('owner_merchant_id')
    .eq('id', orgId)
    .maybeSingle();

  if (!org) return null;
  if (org.owner_merchant_id === userId) return 'owner';

  const { data: om } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('merchant_id', userId)
    .maybeSingle();

  return (om?.role as Role) ?? null;
}

/** Gate a capability on a business. 404 (not 403) when the user has no access at all. */
export async function authorizeBusiness(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  capability: Capability,
): Promise<AuthzResult> {
  const role = await resolveBusinessRole(supabase, userId, businessId);
  if (!role) return { ok: false, status: 404, error: 'Business not found' };
  if (!can(role, capability)) return { ok: false, status: 403, error: 'Insufficient permissions' };
  return { ok: true, role };
}

/** Gate a capability on an organization. */
export async function authorizeOrg(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  capability: Capability,
): Promise<AuthzResult> {
  const role = await resolveOrgRole(supabase, userId, orgId);
  if (!role) return { ok: false, status: 404, error: 'Organization not found' };
  if (!can(role, capability)) return { ok: false, status: 403, error: 'Insufficient permissions' };
  return { ok: true, role };
}

/**
 * Map of every business the user can access -> their effective (highest) role.
 * Used to replace `.eq('merchant_id', userId)` list queries and to drive UI gating.
 */
export async function getAccessibleBusinessRoles(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, Role>> {
  const roles = new Map<string, Role>();
  const bump = (id: string, role: Role) => {
    const current = roles.get(id);
    if (!current || ROLE_RANK[role] > ROLE_RANK[current]) roles.set(id, role);
  };

  // Businesses the user owns directly.
  const { data: owned } = await supabase
    .from('businesses')
    .select('id')
    .eq('merchant_id', userId);
  (owned ?? []).forEach((b: { id: string }) => bump(b.id, 'owner'));

  // Direct per-business memberships.
  const { data: bms } = await supabase
    .from('business_members')
    .select('business_id, role')
    .eq('merchant_id', userId);
  (bms ?? []).forEach((m: { business_id: string; role: Role }) => bump(m.business_id, m.role));

  // Org memberships -> every business in those orgs.
  const { data: oms } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('merchant_id', userId);
  const orgRoleById = new Map<string, Role>(
    (oms ?? []).map((o: { organization_id: string; role: Role }) => [o.organization_id, o.role]),
  );
  const orgIds = [...orgRoleById.keys()];
  if (orgIds.length > 0) {
    const { data: orgBiz } = await supabase
      .from('businesses')
      .select('id, organization_id')
      .in('organization_id', orgIds);
    (orgBiz ?? []).forEach((b: { id: string; organization_id: string }) => {
      const role = orgRoleById.get(b.organization_id);
      if (role) bump(b.id, role);
    });
  }

  return roles;
}

/** Ids of every business the user can access (owned ∪ business-member ∪ org-member). */
export async function listAccessibleBusinessIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  return [...(await getAccessibleBusinessRoles(supabase, userId)).keys()];
}
