import { describe, it, expect } from 'vitest';
import { validateScopes, scopeIncludes, VALID_SCOPES, SCOPE_INFO, describeScope } from './scopes';

describe('OAuth Scopes', () => {
  describe('validateScopes', () => {
    it('should accept valid scopes from a string', () => {
      const result = validateScopes('openid profile email');
      expect(result).toEqual(['openid', 'profile', 'email']);
    });

    it('should accept valid scopes from an array', () => {
      const result = validateScopes(['openid', 'profile']);
      expect(result).toEqual(['openid', 'profile']);
    });

    it('should filter out invalid scopes', () => {
      const result = validateScopes('openid profile bogus fakescope email');
      expect(result).toEqual(['openid', 'profile', 'email']);
      expect(result).not.toContain('bogus');
      expect(result).not.toContain('fakescope');
    });

    it('should auto-add openid if not present but other valid scopes exist', () => {
      const result = validateScopes('profile email');
      expect(result[0]).toBe('openid');
      expect(result).toContain('profile');
      expect(result).toContain('email');
    });

    it('should return empty array for all-invalid scopes', () => {
      const result = validateScopes('bogus fake nope');
      expect(result).toEqual([]);
    });

    it('should handle empty string', () => {
      const result = validateScopes('');
      expect(result).toEqual([]);
    });

    it('should handle did and wallet:read scopes', () => {
      const result = validateScopes('openid did wallet:read');
      expect(result).toContain('did');
      expect(result).toContain('wallet:read');
    });
  });

  describe('scopeIncludes', () => {
    it('should return true when scope is included', () => {
      expect(scopeIncludes(['openid', 'profile', 'email'], 'profile')).toBe(true);
    });

    it('should return false when scope is not included', () => {
      expect(scopeIncludes(['openid', 'profile'], 'email')).toBe(false);
    });

    it('should return false for empty granted scopes', () => {
      expect(scopeIncludes([], 'openid')).toBe(false);
    });
  });

  describe('VALID_SCOPES', () => {
    it('should contain all expected scopes', () => {
      expect(VALID_SCOPES).toContain('openid');
      expect(VALID_SCOPES).toContain('profile');
      expect(VALID_SCOPES).toContain('email');
      expect(VALID_SCOPES).toContain('did');
      expect(VALID_SCOPES).toContain('wallet:read');
    });
  });

  describe('client scope restriction', () => {
    it('drops scopes the client is not registered for', () => {
      // Checking only the global whitelist let a client approved for
      // "openid profile" ask for wallet:read and receive it.
      expect(validateScopes('openid profile wallet:read', ['openid', 'profile']))
        .toEqual(['openid', 'profile']);
    });

    it('grants nothing beyond openid when the client has no registered scopes', () => {
      expect(validateScopes('openid profile email', [])).toEqual(['openid']);
    });

    it('still filters against the global whitelist', () => {
      expect(validateScopes('openid admin:everything', ['openid', 'admin:everything']))
        .toEqual(['openid']);
    });

    it('keeps the old behaviour when no client scopes are supplied', () => {
      expect(validateScopes('openid profile')).toEqual(['openid', 'profile']);
    });
  });

  describe('consent copy', () => {
    it('describes every valid scope', () => {
      for (const scope of VALID_SCOPES) {
        expect(SCOPE_INFO[scope]?.label, scope).toBeTruthy();
        expect(SCOPE_INFO[scope]?.description, scope).toBeTruthy();
      }
    });

    it('marks merchant as sensitive and says it can send money', () => {
      const info = describeScope('merchant');
      expect(info.sensitive).toBe(true);
      expect(info.label).toMatch(/merchant/i);
      // A merchant-scope token reaches /api/payouts/create and
      // /api/banking/transfers, so the copy must not promise otherwise.
      expect(info.description).toMatch(/send payouts/);
      expect(info.description).not.toMatch(/cannot/i);
    });

    it('keeps the read-only scopes unmarked', () => {
      for (const scope of ['openid', 'profile', 'email', 'did', 'wallet:read']) {
        expect(describeScope(scope).sensitive, scope).toBeFalsy();
      }
    });

    it('renders an unknown scope under its own name instead of dropping it', () => {
      const info = describeScope('ledger:write');
      expect(info.label).toBe('ledger:write');
      expect(info.description).toContain('ledger:write');
    });

    it('does not resolve inherited object keys as scopes', () => {
      expect(describeScope('constructor').label).toBe('constructor');
    });
  });
});
