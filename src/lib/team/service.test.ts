import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: 'm1' })),
}));

import { sendEmail } from '@/lib/email';
import {
  inviteMember,
  acceptInvitation,
  updateMemberRole,
  removeMember,
} from './service';

/**
 * Stateful in-memory Supabase mock supporting the builder ops the service uses:
 * select/eq/is/in/order/maybeSingle/single + insert/upsert/update/delete.
 */
function makeDb(initial: Record<string, any[]>) {
  const store: Record<string, any[]> = JSON.parse(JSON.stringify(initial));
  let counter = 0;
  const newId = () => `id-${++counter}`;

  function from(table: string) {
    store[table] = store[table] ?? [];
    const state: any = { filters: [], op: 'select', payload: null, conflict: null };
    const match = (rows: any[]) => rows.filter((r) => state.filters.every((f: any) => f(r)));

    const exec = (single: boolean) => {
      const rows = store[table];
      switch (state.op) {
        case 'select': {
          const m = match(rows);
          return { data: single ? m[0] ?? null : m, error: null };
        }
        case 'insert': {
          const row = { id: newId(), ...state.payload };
          rows.push(row);
          return { data: single ? row : [row], error: null };
        }
        case 'upsert': {
          const keys: string[] = state.conflict ?? [];
          const existing = rows.find((r) => keys.every((k) => r[k] === state.payload[k]));
          let row;
          if (existing) {
            Object.assign(existing, state.payload);
            row = existing;
          } else {
            row = { id: newId(), ...state.payload };
            rows.push(row);
          }
          return { data: single ? row : [row], error: null };
        }
        case 'update': {
          match(rows).forEach((r) => Object.assign(r, state.payload));
          return { data: null, error: null };
        }
        case 'delete': {
          for (const r of match(rows)) rows.splice(rows.indexOf(r), 1);
          return { data: null, error: null };
        }
        default:
          return { data: null, error: null };
      }
    };

    const builder: any = {
      select: () => builder,
      order: () => builder,
      eq: (c: string, v: unknown) => (state.filters.push((r: any) => r[c] === v), builder),
      is: (c: string, v: unknown) => (state.filters.push((r: any) => (r[c] ?? null) === v), builder),
      in: (c: string, vals: unknown[]) => (state.filters.push((r: any) => vals.includes(r[c])), builder),
      insert: (p: any) => ((state.op = 'insert'), (state.payload = p), builder),
      upsert: (p: any, opts: any) => (
        (state.op = 'upsert'),
        (state.payload = p),
        (state.conflict = opts?.onConflict?.split(',')),
        builder
      ),
      update: (p: any) => ((state.op = 'update'), (state.payload = p), builder),
      delete: () => ((state.op = 'delete'), builder),
      maybeSingle: () => Promise.resolve(exec(true)),
      single: () => Promise.resolve(exec(true)),
      then: (resolve: any) => Promise.resolve(exec(false)).then(resolve),
    };
    return builder;
  }

  return { client: { from } as unknown as SupabaseClient, store };
}

const BASE = 'https://coinpayportal.com';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inviteMember', () => {
  it('rejects the owner role', async () => {
    const { client } = makeDb({});
    const res = await inviteMember({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      scopeName: 'Acme',
      email: 'a@b.com',
      role: 'owner' as any,
      invitedByMerchantId: 'owner-1',
      actorRole: 'owner',
      baseUrl: BASE,
    });
    expect(res.success).toBe(false);
  });

  it('forbids an admin from inviting another admin (cannot grant >= own role)', async () => {
    const { client } = makeDb({});
    const res = await inviteMember({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      scopeName: 'Acme',
      email: 'a@b.com',
      role: 'admin',
      invitedByMerchantId: 'admin-1',
      actorRole: 'admin',
      baseUrl: BASE,
    });
    expect(res).toMatchObject({ success: false, status: 403 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects inviting an existing member', async () => {
    const { client } = makeDb({
      merchants: [{ id: 'm-1', email: 'a@b.com' }],
      organization_members: [{ id: 'om-1', organization_id: 'org-1', merchant_id: 'm-1', role: 'writer' }],
    });
    const res = await inviteMember({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      scopeName: 'Acme',
      email: 'A@B.com',
      role: 'writer',
      invitedByMerchantId: 'owner-1',
      actorRole: 'owner',
      baseUrl: BASE,
    });
    expect(res).toMatchObject({ success: false, status: 409 });
  });

  it('creates an invitation and sends email on the happy path', async () => {
    const { client, store } = makeDb({ merchants: [] });
    const res = await inviteMember({
      supabase: client,
      scope: 'business',
      scopeId: 'biz-1',
      scopeName: 'My Shop',
      email: 'New@Person.com',
      role: 'writer',
      invitedByMerchantId: 'owner-1',
      actorRole: 'owner',
      baseUrl: BASE,
    });
    expect(res.success).toBe(true);
    expect(store.business_invitations).toHaveLength(1);
    expect(store.business_invitations[0].email).toBe('new@person.com'); // normalized
    expect(sendEmail).toHaveBeenCalledOnce();
    const arg = (sendEmail as any).mock.calls[0][0];
    expect(arg.to).toBe('new@person.com');
    expect(arg.html).toContain('/invite/accept?token=');
  });
});

describe('acceptInvitation', () => {
  function seedInvite(extra: Partial<any> = {}) {
    return makeDb({
      organization_invitations: [
        {
          id: 'inv-1',
          organization_id: 'org-1',
          email: 'invitee@x.com',
          role: 'readonly',
          token: 'tok-123',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          accepted_at: null,
          ...extra,
        },
      ],
      organization_members: [],
    });
  }

  it('requires the accepting email to match the invitation', async () => {
    const { client } = seedInvite();
    const res = await acceptInvitation({
      supabase: client,
      token: 'tok-123',
      acceptingMerchantId: 'm-9',
      acceptingEmail: 'someone-else@x.com',
    });
    expect(res).toMatchObject({ success: false, status: 403 });
  });

  it('rejects an expired invitation', async () => {
    const { client } = seedInvite({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const res = await acceptInvitation({
      supabase: client,
      token: 'tok-123',
      acceptingMerchantId: 'm-9',
      acceptingEmail: 'invitee@x.com',
    });
    expect(res).toMatchObject({ success: false, status: 410 });
  });

  it('rejects an already-accepted invitation', async () => {
    const { client } = seedInvite({ accepted_at: new Date().toISOString() });
    const res = await acceptInvitation({
      supabase: client,
      token: 'tok-123',
      acceptingMerchantId: 'm-9',
      acceptingEmail: 'invitee@x.com',
    });
    expect(res).toMatchObject({ success: false, status: 409 });
  });

  it('returns not found for an unknown token', async () => {
    const { client } = seedInvite();
    const res = await acceptInvitation({
      supabase: client,
      token: 'nope',
      acceptingMerchantId: 'm-9',
      acceptingEmail: 'invitee@x.com',
    });
    expect(res).toMatchObject({ success: false, status: 404 });
  });

  it('adds membership and marks accepted on success (case-insensitive email)', async () => {
    const { client, store } = seedInvite();
    const res = await acceptInvitation({
      supabase: client,
      token: 'tok-123',
      acceptingMerchantId: 'm-9',
      acceptingEmail: 'INVITEE@x.com',
    });
    expect(res).toMatchObject({ success: true, scope: 'org', scopeId: 'org-1', role: 'readonly' });
    expect(store.organization_members).toHaveLength(1);
    expect(store.organization_members[0]).toMatchObject({ merchant_id: 'm-9', role: 'readonly' });
    expect(store.organization_invitations[0].accepted_at).not.toBeNull();
  });
});

describe('updateMemberRole / removeMember guardrails', () => {
  function seedMembers() {
    return makeDb({
      organization_members: [
        { id: 'om-owner', organization_id: 'org-1', merchant_id: 'owner-1', role: 'owner' },
        { id: 'om-admin', organization_id: 'org-1', merchant_id: 'admin-1', role: 'admin' },
        { id: 'om-writer', organization_id: 'org-1', merchant_id: 'writer-1', role: 'writer' },
      ],
    });
  }

  it('cannot change the owner role', async () => {
    const { client } = seedMembers();
    const res = await updateMemberRole({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      memberId: 'om-owner',
      newRole: 'admin',
      actorRole: 'owner',
    });
    expect(res).toMatchObject({ success: false, status: 403 });
  });

  it('an admin cannot promote a writer to admin (equal to own rank)', async () => {
    const { client } = seedMembers();
    const res = await updateMemberRole({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      memberId: 'om-writer',
      newRole: 'admin',
      actorRole: 'admin',
    });
    expect(res).toMatchObject({ success: false, status: 403 });
  });

  it('owner can demote an admin to writer', async () => {
    const { client, store } = seedMembers();
    const res = await updateMemberRole({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      memberId: 'om-admin',
      newRole: 'writer',
      actorRole: 'owner',
    });
    expect(res.success).toBe(true);
    expect(store.organization_members.find((m) => m.id === 'om-admin')!.role).toBe('writer');
  });

  it('cannot remove the owner', async () => {
    const { client } = seedMembers();
    const res = await removeMember({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      memberId: 'om-owner',
      actorRole: 'owner',
    });
    expect(res).toMatchObject({ success: false, status: 403 });
  });

  it('an admin cannot remove another admin', async () => {
    const { client } = makeDb({
      organization_members: [
        { id: 'om-a1', organization_id: 'org-1', merchant_id: 'a1', role: 'admin' },
        { id: 'om-a2', organization_id: 'org-1', merchant_id: 'a2', role: 'admin' },
      ],
    });
    const res = await removeMember({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      memberId: 'om-a2',
      actorRole: 'admin',
    });
    expect(res).toMatchObject({ success: false, status: 403 });
  });

  it('owner can remove a writer', async () => {
    const { client, store } = seedMembers();
    const res = await removeMember({
      supabase: client,
      scope: 'org',
      scopeId: 'org-1',
      memberId: 'om-writer',
      actorRole: 'owner',
    });
    expect(res.success).toBe(true);
    expect(store.organization_members.find((m) => m.id === 'om-writer')).toBeUndefined();
  });
});
