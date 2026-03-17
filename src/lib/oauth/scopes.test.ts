import { describe, it, expect } from 'vitest';
import { validateScopes, scopeIncludes, VALID_SCOPES } from './scopes';

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
});
