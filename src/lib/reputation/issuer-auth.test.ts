import { describe, it, expect } from 'vitest';
import { bearerToken, issuerOwnsDid } from './issuer-auth';

describe('bearerToken', () => {
  it('extracts a Bearer token', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
  });

  it('rejects missing, empty and non-Bearer headers', () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
  });
});

describe('issuerOwnsDid', () => {
  it('matches identical DIDs', () => {
    expect(issuerOwnsDid('did:key:z6MkA', 'did:key:z6MkA')).toBe(true);
  });

  it('is case-sensitive outside did:web', () => {
    expect(issuerOwnsDid('did:key:z6MkA', 'did:key:z6Mka')).toBe(false);
  });

  it('compares did:web hosts case-insensitively', () => {
    expect(issuerOwnsDid('did:web:Infernetprotocol.com', 'did:web:infernetprotocol.com')).toBe(true);
  });

  it('keeps did:web path segments case-sensitive', () => {
    expect(issuerOwnsDid('did:web:example.com:users:Alice', 'did:web:example.com:users:alice')).toBe(false);
  });

  it('rejects a different issuer', () => {
    expect(issuerOwnsDid('did:web:example.com', 'did:web:ugig.net')).toBe(false);
    expect(issuerOwnsDid('did:web:example.com', 'did:web:example.com.evil')).toBe(false);
  });
});
