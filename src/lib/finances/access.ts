import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { type Role, type Capability, can, ROLE_RANK } from '@/lib/auth/permissions';

/**
 * Whose books a /finances request acts on, and whether the caller may.
 *
 * Finance data is owned by a merchant (`finance_connections.merchant_id`) and every
 * service in src/lib/finances scopes by that id. Before teammates existed the owner
 * was always the signed-in merchant, which is what `requireMerchant` returns. This
 * guard keeps that contract (`.id` is still the OWNER to scope by) and adds one way
 * to act on somebody else's books: being a member of an organization they own, with
 * `finance_access` granted by them, and a role whose capabilities cover the action.
 *
 * The owner to act on comes from the `x-finance-owner` header or the
 * `finance_owner` cookie the Finances switcher sets; absent both, it is the caller.
 * The selection is never trusted on its own: it is re-authorized on every request,
 * so a revoked teammate loses access on their next call, not when a token expires.
 */

export const FINANCE_OWNER_COOKIE = 'finance_owner';
export const FINANCE_OWNER_HEADER = 'x-finance-owner';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FinanceAccess = {
  /** The books' owner. Scope every finance query by this. */
  id: string;
  /** The owner's email (default recipient for their schedules and packs). */
  email: string;
  /** Who is actually signed in. Equal to `id` when acting on your own books. */
  actorId: string;
  actorEmail: string;
  role: Role;
};

function maxRole(a: Role | null, b: Role): Role {
  return a && ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/** A teammate is never `owner` of somebody else's books; cap at admin. */
function teammateRole(role: Role): Role {
  return role === 'owner' ? 'admin' : role;
}

/**
 * The caller's role on `ownerId`'s books, or null. Only org memberships with
 * finance_access count; a business-level membership never grants finances.
 */
export async function resolveFinanceRole(
  supabase: SupabaseClient,
  actorId: string,
  ownerId: string,
): Promise<Role | null> {
  if (actorId === ownerId) return 'owner';
  const { data } = await supabase
    .from('organization_members')
    .select('role, organizations!inner(owner_merchant_id)')
    .eq('merchant_id', actorId)
    .eq('finance_access', true)
    .eq('organizations.owner_merchant_id', ownerId);
  let role: Role | null = null;
  for (const row of (data ?? []) as Array<{ role: Role }>) {
    role = maxRole(role, teammateRole(row.role));
  }
  return role;
}

export type FinanceOwnerOption = {
  ownerId: string;
  email: string | null;
  name: string | null;
  role: Role;
  organizations: string[];
  self: boolean;
};

/** Every set of books the caller can open: their own first, then shared ones. */
export async function listFinanceOwners(
  supabase: SupabaseClient,
  actorId: string,
  actorEmail: string,
): Promise<FinanceOwnerOption[]> {
  const own: FinanceOwnerOption = {
    ownerId: actorId,
    email: actorEmail,
    name: null,
    role: 'owner',
    organizations: [],
    self: true,
  };
  const { data } = await supabase
    .from('organization_members')
    .select('role, organizations!inner(name, owner_merchant_id)')
    .eq('merchant_id', actorId)
    .eq('finance_access', true);

  type OrgRef = { name: string | null; owner_merchant_id: string };
  const byOwner = new Map<string, FinanceOwnerOption>();
  for (const row of (data ?? []) as unknown as Array<{ role: Role; organizations: OrgRef | OrgRef[] | null }>) {
    // A many-to-one embed is an object at runtime; the generated types say array.
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    const ownerId = org?.owner_merchant_id;
    if (!org || !ownerId || ownerId === actorId) continue;
    const role = teammateRole(row.role);
    const existing = byOwner.get(ownerId);
    if (existing) {
      existing.role = maxRole(existing.role, role);
      if (org.name) existing.organizations.push(org.name);
    } else {
      byOwner.set(ownerId, {
        ownerId,
        email: null,
        name: null,
        role,
        organizations: org.name ? [org.name] : [],
        self: false,
      });
    }
  }

  if (byOwner.size > 0) {
    const { data: owners } = await supabase
      .from('merchants')
      .select('id, email, name')
      .in('id', [...byOwner.keys()]);
    for (const m of (owners ?? []) as Array<{ id: string; email: string | null; name: string | null }>) {
      const opt = byOwner.get(m.id);
      if (opt) {
        opt.email = m.email;
        opt.name = m.name;
      }
    }
  }
  return [own, ...byOwner.values()];
}

function requestedOwner(req: NextRequest): string | null {
  const raw = req.headers.get(FINANCE_OWNER_HEADER) ?? req.cookies.get(FINANCE_OWNER_COOKIE)?.value ?? null;
  const value = raw?.trim();
  return value ? value : null;
}

/**
 * `requireMerchant` for /finances: authenticate, pick whose books, and gate the
 * capability. Pass `{ write: true }` for anything that changes state so the
 * cross-site checks of `requireMerchantForWrite` still apply.
 */
export async function requireFinanceAccess(
  req: NextRequest,
  capability: Capability,
  opts: { write?: boolean } = {},
): Promise<FinanceAccess | NextResponse> {
  const guard = opts.write ? await requireMerchantForWrite(req) : await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const target = requestedOwner(req);
  if (!target || target === guard.id) {
    return { id: guard.id, email: guard.email, actorId: guard.id, actorEmail: guard.email, role: 'owner' };
  }
  if (!UUID_RE.test(target)) {
    return NextResponse.json({ error: 'Invalid finance owner', code: 'finance_owner_invalid' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const role = await resolveFinanceRole(supabase, guard.id, target);
  if (!role) {
    // 404, not 403: do not confirm that somebody else's books exist.
    return NextResponse.json(
      { error: 'Finances not found', code: 'finance_owner_forbidden' },
      { status: 404 },
    );
  }
  if (!can(role, capability)) {
    return NextResponse.json(
      { error: 'Your role on these books does not allow this', code: 'finance_role_insufficient', role },
      { status: 403 },
    );
  }

  const { data: owner } = await supabase.from('merchants').select('email').eq('id', target).maybeSingle();
  return {
    id: target,
    email: owner?.email ?? '',
    actorId: guard.id,
    actorEmail: guard.email,
    role,
  };
}
