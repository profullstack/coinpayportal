/**
 * Team-member roles and capabilities (pure — no DB access).
 *
 * coinpayportal enforces authorization in the app layer (the Supabase service-role
 * client bypasses RLS), so these roles are the source of truth for what a team member
 * may do. `src/lib/auth/authz.ts` resolves a merchant's effective Role for a given
 * business/org, then routes call `can(role, capability)` to gate each action.
 *
 * Role ordering (highest first): owner > admin > writer > readonly.
 *
 *   readonly  — view everything in scope, no writes.
 *   writer    — "need-to-know writes": operational records only
 *               (invoices, payment links, customers, mark-paid).
 *   admin     — writer + manage team, settings, billing, API keys, webhook secrets.
 *   owner     — admin + move funds (wallet/payout/forwarding addresses, withdrawals)
 *               and destructive actions (delete business/org, transfer ownership).
 *
 * Funds movement is OWNER-ONLY by design on this crypto platform.
 */

export type Role = 'owner' | 'admin' | 'writer' | 'readonly';

export type Capability =
  // reads
  | 'business.read'
  // operational writes (writer+)
  | 'invoice.write'
  | 'paymentlink.write'
  | 'customer.write'
  | 'payment.markPaid'
  // management (admin+)
  | 'business.update'
  | 'team.manage'
  | 'apikey.manage'
  | 'webhook.manage'
  | 'settings.manage'
  | 'billing.manage'
  // owner-only
  | 'business.delete'
  | 'funds.move';

/** Rank used to compare roles (e.g. you cannot grant a role >= your own). */
export const ROLE_RANK: Record<Role, number> = {
  owner: 3,
  admin: 2,
  writer: 1,
  readonly: 0,
};

const READ: Capability[] = ['business.read'];

const WRITER_CAPS: Capability[] = [
  ...READ,
  'invoice.write',
  'paymentlink.write',
  'customer.write',
  'payment.markPaid',
];

const ADMIN_CAPS: Capability[] = [
  ...WRITER_CAPS,
  'business.update',
  'team.manage',
  'apikey.manage',
  'webhook.manage',
  'settings.manage',
  'billing.manage',
];

const OWNER_CAPS: Capability[] = [...ADMIN_CAPS, 'business.delete', 'funds.move'];

export const ROLE_CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  readonly: new Set(READ),
  writer: new Set(WRITER_CAPS),
  admin: new Set(ADMIN_CAPS),
  owner: new Set(OWNER_CAPS),
};

/** Roles that can be assigned via an invitation (owner is never invited). */
export const INVITABLE_ROLES: Role[] = ['admin', 'writer', 'readonly'];

/** Whether a role is permitted to perform a capability. */
export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}

/** True when `actorRole` is allowed to grant/assign `targetRole` (must be strictly higher). */
export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

/** Type guard for untrusted role strings (e.g. request bodies). */
export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'admin' || value === 'writer' || value === 'readonly';
}
