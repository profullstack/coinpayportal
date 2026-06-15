import { describe, it, expect } from 'vitest';
import {
  can,
  canAssignRole,
  isRole,
  ROLE_RANK,
  INVITABLE_ROLES,
  type Role,
  type Capability,
} from './permissions';

describe('permissions: can()', () => {
  it('readonly can only read', () => {
    expect(can('readonly', 'business.read')).toBe(true);
    expect(can('readonly', 'invoice.write')).toBe(false);
    expect(can('readonly', 'team.manage')).toBe(false);
    expect(can('readonly', 'funds.move')).toBe(false);
  });

  it('writer can do operational writes but no management', () => {
    const allowed: Capability[] = [
      'business.read',
      'invoice.write',
      'paymentlink.write',
      'customer.write',
      'payment.markPaid',
    ];
    for (const c of allowed) expect(can('writer', c)).toBe(true);

    const denied: Capability[] = [
      'business.update',
      'team.manage',
      'apikey.manage',
      'webhook.manage',
      'settings.manage',
      'billing.manage',
      'business.delete',
      'funds.move',
    ];
    for (const c of denied) expect(can('writer', c)).toBe(false);
  });

  it('admin manages but cannot move funds or delete business', () => {
    const allowed: Capability[] = [
      'invoice.write',
      'team.manage',
      'apikey.manage',
      'webhook.manage',
      'settings.manage',
      'billing.manage',
      'business.update',
    ];
    for (const c of allowed) expect(can('admin', c)).toBe(true);

    expect(can('admin', 'funds.move')).toBe(false);
    expect(can('admin', 'business.delete')).toBe(false);
  });

  it('owner can do everything including funds and delete', () => {
    const all: Capability[] = [
      'business.read',
      'invoice.write',
      'paymentlink.write',
      'customer.write',
      'payment.markPaid',
      'business.update',
      'team.manage',
      'apikey.manage',
      'webhook.manage',
      'settings.manage',
      'billing.manage',
      'business.delete',
      'funds.move',
    ];
    for (const c of all) expect(can('owner', c)).toBe(true);
  });

  it('funds.move is owner-only', () => {
    const roles: Role[] = ['readonly', 'writer', 'admin', 'owner'];
    for (const r of roles) {
      expect(can(r, 'funds.move')).toBe(r === 'owner');
    }
  });

  it('returns false for null/undefined role', () => {
    expect(can(null, 'business.read')).toBe(false);
    expect(can(undefined, 'business.read')).toBe(false);
  });
});

describe('permissions: role ranking and assignment', () => {
  it('ranks owner > admin > writer > readonly', () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.writer);
    expect(ROLE_RANK.writer).toBeGreaterThan(ROLE_RANK.readonly);
  });

  it('admins cannot assign owner or admin, but can assign writer/readonly', () => {
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'writer')).toBe(true);
    expect(canAssignRole('admin', 'readonly')).toBe(true);
  });

  it('owner can assign any non-owner role', () => {
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'writer')).toBe(true);
    expect(canAssignRole('owner', 'readonly')).toBe(true);
    expect(canAssignRole('owner', 'owner')).toBe(false);
  });

  it('INVITABLE_ROLES excludes owner', () => {
    expect(INVITABLE_ROLES).not.toContain('owner');
    expect(INVITABLE_ROLES).toEqual(expect.arrayContaining(['admin', 'writer', 'readonly']));
  });
});

describe('permissions: isRole()', () => {
  it('accepts valid roles and rejects junk', () => {
    expect(isRole('owner')).toBe(true);
    expect(isRole('admin')).toBe(true);
    expect(isRole('writer')).toBe(true);
    expect(isRole('readonly')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(3)).toBe(false);
  });
});
