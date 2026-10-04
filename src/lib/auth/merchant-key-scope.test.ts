import { describe, expect, it } from 'vitest';
import { keyMayActOnBusiness } from './merchant';

/**
 * Regression tests for C-02 (High, 2026-08-19 audit).
 *
 * `resolveMerchant` returns `apiKeyBusinessId` — the business the API key
 * belongs to — and its own doc comment says callers "can use it to lock writes
 * to that business and reject mismatched `business_id`". Half of them did not.
 *
 * The gap is easy to miss because the routes *do* authorize: they call
 * `verifyBusinessAccess` or `authorizeBusiness`, which check the **merchant's**
 * access. A scoped key resolves to the owning merchant, and that merchant has
 * access to all of their own businesses — so the check passes for every one of
 * them. A key handed to an integrator for one business could act on the rest.
 */

const KEY_FOR_A = { apiKeyBusinessId: 'biz-a' };
const SESSION = { apiKeyBusinessId: null };

describe('keyMayActOnBusiness', () => {
  it('lets a scoped key act on its own business', () => {
    expect(keyMayActOnBusiness(KEY_FOR_A, 'biz-a')).toBe(true);
  });

  it('stops a scoped key acting on a sibling business', () => {
    // The finding in one line. Both businesses belong to the same merchant, so
    // every ownership check in the codebase says yes.
    expect(keyMayActOnBusiness(KEY_FOR_A, 'biz-b')).toBe(false);
  });

  it('does not constrain session auth, which has no key scope', () => {
    // A JWT is the merchant themselves; their own ownership check governs, and
    // this helper must not be mistaken for that check.
    expect(keyMayActOnBusiness(SESSION, 'biz-a')).toBe(true);
    expect(keyMayActOnBusiness(SESSION, 'biz-b')).toBe(true);
  });

  it('permits an unscoped request from a scoped key', () => {
    // No business named: the route's own logic decides what that means, and
    // callers narrow to `apiKeyBusinessId` where a default is needed.
    expect(keyMayActOnBusiness(KEY_FOR_A, null)).toBe(true);
    expect(keyMayActOnBusiness(KEY_FOR_A, undefined)).toBe(true);
  });
});
