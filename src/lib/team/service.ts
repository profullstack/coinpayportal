/**
 * Team-member management: invitations, acceptance, and membership CRUD for both
 * organizations and individual businesses.
 *
 * Authorization (does the actor hold `team.manage`?) is enforced by the route via
 * src/lib/auth/authz.ts; this service receives the actor's resolved role and applies
 * the finer-grained guardrails:
 *   - owner is never invited and never demoted/removed here;
 *   - a non-owner cannot grant or manage a role >= their own (admins can't mint admins);
 *   - accepting an invitation never creates a membership: only the owner's approval does
 *     (approveInvitation), so nobody joins a team the owner has not said yes to.
 *
 * Mirrors the password-reset token pattern in src/lib/auth/service.ts and sends mail
 * through src/lib/email (Resend/Mailgun).
 */

import { escapeHtml, escapeUrl } from '../email/escape';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { sendEmail } from '@/lib/email';
import {
  type Role,
  INVITABLE_ROLES,
  isRole,
  canAssignRole,
  ROLE_RANK,
} from '@/lib/auth/permissions';

export type Scope = 'org' | 'business';

export type ServiceResult<T = unknown> =
  | ({ success: true } & T)
  | { success: false; error: string; status?: number };

function membersTable(scope: Scope): 'organization_members' | 'business_members' {
  return scope === 'org' ? 'organization_members' : 'business_members';
}
function invitesTable(scope: Scope): 'organization_invitations' | 'business_invitations' {
  return scope === 'org' ? 'organization_invitations' : 'business_invitations';
}
function scopeCol(scope: Scope): 'organization_id' | 'business_id' {
  return scope === 'org' ? 'organization_id' : 'business_id';
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Actor may manage a target member only when strictly higher-ranked. */
function canManageTarget(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

export type MemberView = {
  id: string;
  merchantId: string;
  email: string | null;
  name: string | null;
  role: Role;
  /** Org members only: may open the org owner's Finances. Always false for businesses. */
  financeAccess: boolean;
  createdAt: string;
};

export type InvitationView = {
  id: string;
  email: string;
  role: Role;
  financeAccess: boolean;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  /** Set once someone accepted: they are waiting for the owner's approval. */
  acceptedByEmail: string | null;
  createdAt: string;
};

/** List active members of an org/business with their merchant email + name. */
export async function listMembers(
  supabase: SupabaseClient,
  scope: Scope,
  scopeId: string,
): Promise<MemberView[]> {
  const { data, error } = await supabase
    .from(membersTable(scope))
    .select(
      scope === 'org'
        ? 'id, merchant_id, role, finance_access, created_at, merchants(email, name)'
        : 'id, merchant_id, role, created_at, merchants(email, name)',
    )
    .eq(scopeCol(scope), scopeId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    merchantId: row.merchant_id,
    email: row.merchants?.email ?? null,
    name: row.merchants?.name ?? null,
    role: row.role as Role,
    financeAccess: row.finance_access === true,
    createdAt: row.created_at,
  }));
}

/**
 * List open invitations for an org/business: not yet accepted, or accepted and
 * waiting for the owner's approval (acceptedAt set).
 */
export async function listInvitations(
  supabase: SupabaseClient,
  scope: Scope,
  scopeId: string,
): Promise<InvitationView[]> {
  const { data, error } = await supabase
    .from(invitesTable(scope))
    .select(
      scope === 'org'
        ? 'id, email, role, finance_access, invited_by, expires_at, accepted_at, created_at, accepted_by:merchants!accepted_by_merchant_id(email)'
        : 'id, email, role, invited_by, expires_at, accepted_at, created_at, accepted_by:merchants!accepted_by_merchant_id(email)',
    )
    .eq(scopeCol(scope), scopeId)
    .is('approved_at', null)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    email: row.email,
    role: row.role as Role,
    financeAccess: row.finance_access === true,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedByEmail: row.accepted_by?.email ?? null,
    createdAt: row.created_at,
  }));
}

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  writer: 'Read & write',
  readonly: 'Read only',
};

function invitationEmailHtml(opts: {
  scopeLabel: string;
  role: Role;
  acceptUrl: string;
  financeAccess?: boolean;
}): string {
  // `scopeLabel` is the business or organization NAME, chosen by whoever
  // created it — and creating a merchant account is free and unverified. It was
  // interpolated raw into an email delivered to an arbitrary address the same
  // caller supplies, which makes this a way to send attacker-authored HTML from
  // the platform's own sending domain, to anyone, with no rate limit.
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>You've been invited to ${escapeHtml(opts.scopeLabel)} on CoinPay</h2>
      <p>You've been invited with <strong>${escapeHtml(ROLE_LABEL[opts.role] ?? opts.role)}</strong> access${opts.financeAccess ? ', including the owner&#39;s Finances (bank and card transactions, books and reports)' : ''}. Click below to accept. The owner then approves you before you can open the workspace.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeUrl(opts.acceptUrl)}"
           style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">
          Accept invitation
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;">This invitation expires in 7 days. If you didn't expect this, you can ignore this email.</p>
      <p style="color:#9ca3af;font-size:12px;word-break:break-all;">${escapeHtml(opts.acceptUrl)}</p>
    </div>
  `;
}

/**
 * Create (or refresh) an invitation and email it.
 * `actorRole` is the inviter's resolved role on the scope; `scopeName` is used in the
 * email subject/body.
 */
export async function inviteMember(opts: {
  supabase: SupabaseClient;
  scope: Scope;
  scopeId: string;
  scopeName: string;
  email: string;
  role: Role;
  invitedByMerchantId: string;
  actorRole: Role;
  baseUrl: string;
  /** Org invites only: also open the org owner's Finances. Owner-only to grant. */
  financeAccess?: boolean;
}): Promise<ServiceResult<{ invitation: { id: string; token: string; email: string; role: Role } }>> {
  const { supabase, scope, scopeId, scopeName, role, invitedByMerchantId, actorRole, baseUrl } = opts;
  const email = normalizeEmail(opts.email);
  const financeAccess = opts.financeAccess === true;

  if (financeAccess && scope !== 'org') {
    return { success: false, error: 'Finance access is granted on an organization, not a business', status: 400 };
  }
  if (financeAccess && actorRole !== 'owner') {
    // The books are the owner's bank and card accounts; an admin cannot hand them out.
    return { success: false, error: 'Only the organization owner can grant finance access', status: 403 };
  }

  if (!isRole(role) || !INVITABLE_ROLES.includes(role)) {
    return { success: false, error: 'Invalid role', status: 400 };
  }
  if (!canAssignRole(actorRole, role)) {
    return { success: false, error: 'You cannot grant a role at or above your own', status: 403 };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'Invalid email address', status: 400 };
  }

  // Reject inviting someone who is already a member.
  const { data: existingMerchant } = await supabase
    .from('merchants')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existingMerchant) {
    const { data: existingMember } = await supabase
      .from(membersTable(scope))
      .select('id')
      .eq(scopeCol(scope), scopeId)
      .eq('merchant_id', existingMerchant.id)
      .maybeSingle();
    if (existingMember) {
      return { success: false, error: 'That person is already a member', status: 409 };
    }
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Upsert keeps a single live invite per (scope, email); a re-invite refreshes it.
  const { data: invitation, error } = await supabase
    .from(invitesTable(scope))
    .upsert(
      {
        [scopeCol(scope)]: scopeId,
        email,
        role,
        token,
        invited_by: invitedByMerchantId,
        expires_at: expiresAt,
        accepted_at: null,
        accepted_by_merchant_id: null,
        approved_at: null,
        approved_by: null,
        ...(scope === 'org' ? { finance_access: financeAccess } : {}),
      },
      { onConflict: `${scopeCol(scope)},email` },
    )
    .select('id, token, email, role')
    .single();

  if (error || !invitation) {
    return { success: false, error: error?.message ?? 'Failed to create invitation', status: 500 };
  }

  const acceptUrl = `${baseUrl.replace(/\/$/, '')}/invite/accept?token=${invitation.token}`;
  await sendEmail({
    to: email,
    subject: `You've been invited to ${scopeName} on CoinPay`,
    html: invitationEmailHtml({
      scopeLabel: scope === 'org' ? `${scopeName}` : `the "${scopeName}" business`,
      role,
      acceptUrl,
      financeAccess,
    }),
  });

  return {
    success: true,
    invitation: {
      id: invitation.id,
      token: invitation.token,
      email: invitation.email,
      role: invitation.role as Role,
    },
  };
}

type FoundInvitation = {
  scope: Scope;
  id: string;
  scopeId: string;
  email: string;
  role: Role;
  financeAccess: boolean;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  approvedAt: string | null;
};

async function findInvitationByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<FoundInvitation | null> {
  const { data: org } = await supabase
    .from('organization_invitations')
    .select('id, organization_id, email, role, finance_access, expires_at, accepted_at, accepted_by_merchant_id, approved_at')
    .eq('token', token)
    .maybeSingle();
  if (org) {
    return {
      scope: 'org',
      id: org.id,
      scopeId: org.organization_id,
      email: org.email,
      role: org.role as Role,
      financeAccess: org.finance_access === true,
      expiresAt: org.expires_at,
      acceptedAt: org.accepted_at,
      acceptedBy: org.accepted_by_merchant_id ?? null,
      approvedAt: org.approved_at ?? null,
    };
  }

  const { data: biz } = await supabase
    .from('business_invitations')
    .select('id, business_id, email, role, expires_at, accepted_at, accepted_by_merchant_id, approved_at')
    .eq('token', token)
    .maybeSingle();
  if (biz) {
    return {
      scope: 'business',
      id: biz.id,
      scopeId: biz.business_id,
      email: biz.email,
      role: biz.role as Role,
      financeAccess: false,
      expiresAt: biz.expires_at,
      acceptedAt: biz.accepted_at,
      acceptedBy: biz.accepted_by_merchant_id ?? null,
      approvedAt: biz.approved_at ?? null,
    };
  }

  return null;
}

/** Owner merchant id + display name of an org/business. */
async function scopeOwner(
  supabase: SupabaseClient,
  scope: Scope,
  scopeId: string,
): Promise<{ ownerId: string; name: string } | null> {
  if (scope === 'org') {
    const { data } = await supabase
      .from('organizations')
      .select('owner_merchant_id, name')
      .eq('id', scopeId)
      .maybeSingle();
    return data ? { ownerId: data.owner_merchant_id, name: data.name ?? 'your organization' } : null;
  }
  const { data } = await supabase
    .from('businesses')
    .select('merchant_id, name')
    .eq('id', scopeId)
    .maybeSingle();
  return data ? { ownerId: data.merchant_id, name: data.name ?? 'your business' } : null;
}

/**
 * Accept an invitation. The accepting merchant's email MUST match the invited email,
 * which is the security check that prevents a leaked token from being used by anyone
 * other than the intended recipient.
 *
 * Accepting does NOT add anyone to the team. It records who accepted and asks the
 * owner, who approves or rejects it in Settings -> Team (approveInvitation).
 */
export async function acceptInvitation(opts: {
  supabase: SupabaseClient;
  token: string;
  acceptingMerchantId: string;
  acceptingEmail: string;
  baseUrl?: string;
}): Promise<ServiceResult<{ scope: Scope; scopeId: string; role: Role; pendingApproval: true }>> {
  const { supabase, token, acceptingMerchantId } = opts;
  const acceptingEmail = normalizeEmail(opts.acceptingEmail);

  const invitation = await findInvitationByToken(supabase, token);
  if (!invitation) {
    return { success: false, error: 'Invitation not found', status: 404 };
  }
  if (invitation.acceptedAt) {
    return { success: false, error: 'Invitation already accepted', status: 409 };
  }
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    return { success: false, error: 'Invitation has expired', status: 410 };
  }
  if (normalizeEmail(invitation.email) !== acceptingEmail) {
    return {
      success: false,
      error: 'This invitation was sent to a different email address',
      status: 403,
    };
  }

  const { error } = await supabase
    .from(invitesTable(invitation.scope))
    .update({ accepted_at: new Date().toISOString(), accepted_by_merchant_id: acceptingMerchantId })
    .eq('id', invitation.id);
  if (error) {
    return { success: false, error: error.message, status: 500 };
  }

  const owner = await scopeOwner(supabase, invitation.scope, invitation.scopeId);
  if (owner) {
    const { data: ownerMerchant } = await supabase
      .from('merchants')
      .select('email')
      .eq('id', owner.ownerId)
      .maybeSingle();
    if (ownerMerchant?.email) {
      const teamUrl = `${(opts.baseUrl ?? '').replace(/\/$/, '')}/settings/team`;
      await sendEmail({
        to: ownerMerchant.email,
        subject: `${acceptingEmail} wants to join ${owner.name} on CoinPay`,
        html: `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Approve a new team member?</h2>
      <p><strong>${escapeHtml(acceptingEmail)}</strong> accepted an invitation to ${escapeHtml(owner.name)} with <strong>${escapeHtml(ROLE_LABEL[invitation.role] ?? invitation.role)}</strong> access${invitation.financeAccess ? ', including your Finances' : ''}.</p>
      <p>They cannot see anything until you approve them. If you did not expect this, reject it and check who sent the invitation.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeUrl(teamUrl)}"
           style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">
          Review in Settings &rarr; Team
        </a>
      </p>
    </div>
  `,
      }).catch(() => undefined);
    }
  }

  return {
    success: true,
    scope: invitation.scope,
    scopeId: invitation.scopeId,
    role: invitation.role,
    pendingApproval: true,
  };
}

/**
 * Approve an accepted invitation and create the membership. OWNER ONLY: an admin can
 * send invitations but cannot let anyone in.
 */
export async function approveInvitation(opts: {
  supabase: SupabaseClient;
  scope: Scope;
  scopeId: string;
  invitationId: string;
  actorRole: Role;
  approvedByMerchantId: string;
}): Promise<ServiceResult<{ memberMerchantId: string; role: Role }>> {
  const { supabase, scope, scopeId, invitationId, actorRole, approvedByMerchantId } = opts;
  if (actorRole !== 'owner') {
    return { success: false, error: 'Only the owner can approve new team members', status: 403 };
  }

  const { data: inv } = await supabase
    .from(invitesTable(scope))
    .select(
      scope === 'org'
        ? 'id, role, finance_access, accepted_at, accepted_by_merchant_id, approved_at'
        : 'id, role, accepted_at, accepted_by_merchant_id, approved_at',
    )
    .eq(scopeCol(scope), scopeId)
    .eq('id', invitationId)
    .maybeSingle();
  const row = inv as any;
  if (!row) {
    return { success: false, error: 'Invitation not found', status: 404 };
  }
  if (row.approved_at) {
    return { success: false, error: 'Invitation already approved', status: 409 };
  }
  if (!row.accepted_at || !row.accepted_by_merchant_id) {
    return { success: false, error: 'Nobody has accepted this invitation yet', status: 409 };
  }
  const role = row.role as Role;
  if (!isRole(role) || !INVITABLE_ROLES.includes(role)) {
    return { success: false, error: 'Invalid role', status: 400 };
  }

  const { error: memberError } = await supabase.from(membersTable(scope)).upsert(
    {
      [scopeCol(scope)]: scopeId,
      merchant_id: row.accepted_by_merchant_id,
      role,
      ...(scope === 'org' ? { finance_access: row.finance_access === true } : {}),
    },
    { onConflict: `${scopeCol(scope)},merchant_id` },
  );
  if (memberError) {
    return { success: false, error: memberError.message, status: 500 };
  }

  await supabase
    .from(invitesTable(scope))
    .update({ approved_at: new Date().toISOString(), approved_by: approvedByMerchantId })
    .eq('id', invitationId);

  return { success: true, memberMerchantId: row.accepted_by_merchant_id, role };
}

/** Change a member's role. Cannot touch owners, cannot set owner, rank-gated by actor. */
export async function updateMemberRole(opts: {
  supabase: SupabaseClient;
  scope: Scope;
  scopeId: string;
  memberId: string;
  newRole: Role;
  actorRole: Role;
}): Promise<ServiceResult> {
  const { supabase, scope, scopeId, memberId, newRole, actorRole } = opts;

  if (!isRole(newRole) || !INVITABLE_ROLES.includes(newRole)) {
    return { success: false, error: 'Invalid role', status: 400 };
  }

  const { data: member } = await supabase
    .from(membersTable(scope))
    .select('id, role')
    .eq(scopeCol(scope), scopeId)
    .eq('id', memberId)
    .maybeSingle();
  if (!member) {
    return { success: false, error: 'Member not found', status: 404 };
  }
  if (member.role === 'owner') {
    return { success: false, error: 'Cannot change the owner role', status: 403 };
  }
  if (!canManageTarget(actorRole, member.role as Role) || !canAssignRole(actorRole, newRole)) {
    return { success: false, error: 'Insufficient permissions for this role change', status: 403 };
  }

  const { error } = await supabase
    .from(membersTable(scope))
    .update({ role: newRole })
    .eq('id', memberId);
  if (error) {
    return { success: false, error: error.message, status: 500 };
  }
  return { success: true };
}

/**
 * Grant or revoke a member's access to the org owner's Finances. Owner-only: the
 * books are the owner's own bank and card accounts.
 */
export async function setMemberFinanceAccess(opts: {
  supabase: SupabaseClient;
  orgId: string;
  memberId: string;
  financeAccess: boolean;
  actorRole: Role;
}): Promise<ServiceResult> {
  const { supabase, orgId, memberId, financeAccess, actorRole } = opts;
  if (actorRole !== 'owner') {
    return { success: false, error: 'Only the organization owner can change finance access', status: 403 };
  }
  const { data: member } = await supabase
    .from('organization_members')
    .select('id, role')
    .eq('organization_id', orgId)
    .eq('id', memberId)
    .maybeSingle();
  if (!member) {
    return { success: false, error: 'Member not found', status: 404 };
  }
  if (member.role === 'owner') {
    return { success: false, error: 'The owner always has their own finances', status: 400 };
  }
  const { error } = await supabase
    .from('organization_members')
    .update({ finance_access: financeAccess })
    .eq('id', memberId);
  if (error) {
    return { success: false, error: error.message, status: 500 };
  }
  return { success: true };
}

/** Remove a member. Cannot remove owners; rank-gated by actor. */
export async function removeMember(opts: {
  supabase: SupabaseClient;
  scope: Scope;
  scopeId: string;
  memberId: string;
  actorRole: Role;
}): Promise<ServiceResult> {
  const { supabase, scope, scopeId, memberId, actorRole } = opts;

  const { data: member } = await supabase
    .from(membersTable(scope))
    .select('id, role')
    .eq(scopeCol(scope), scopeId)
    .eq('id', memberId)
    .maybeSingle();
  if (!member) {
    return { success: false, error: 'Member not found', status: 404 };
  }
  if (member.role === 'owner') {
    return { success: false, error: 'Cannot remove the owner', status: 403 };
  }
  if (!canManageTarget(actorRole, member.role as Role)) {
    return { success: false, error: 'Insufficient permissions to remove this member', status: 403 };
  }

  const { error } = await supabase.from(membersTable(scope)).delete().eq('id', memberId);
  if (error) {
    return { success: false, error: error.message, status: 500 };
  }
  return { success: true };
}

/** Revoke a pending invitation. */
export async function revokeInvitation(opts: {
  supabase: SupabaseClient;
  scope: Scope;
  scopeId: string;
  invitationId: string;
}): Promise<ServiceResult> {
  const { supabase, scope, scopeId, invitationId } = opts;
  const { error } = await supabase
    .from(invitesTable(scope))
    .delete()
    .eq(scopeCol(scope), scopeId)
    .eq('id', invitationId);
  if (error) {
    return { success: false, error: error.message, status: 500 };
  }
  return { success: true };
}
