import { describe, it, expect } from 'vitest';
import { sanitizeX402Metadata } from './metadata';

describe('sanitizeX402Metadata', () => {
  it('keeps the known fields', () => {
    expect(
      sanitizeX402Metadata({
        property: 'example.com',
        resource_path: '/posts/1?x=2',
        payer: '0xabc',
        user_agent: 'GPTBot/1.2',
        ip_hash: 'deadbeef',
      }),
    ).toEqual({
      property: 'example.com',
      resource_path: '/posts/1?x=2',
      payer: '0xabc',
      user_agent: 'GPTBot/1.2',
      ip_hash: 'deadbeef',
    });
  });

  it('drops unknown keys, nested values and empties', () => {
    expect(sanitizeX402Metadata({ property: ' a.com ', ip: '1.2.3.4', nested: { a: 1 }, payer: '' })).toEqual({
      property: 'a.com',
    });
  });

  it('caps lengths and strips control characters', () => {
    const out = sanitizeX402Metadata({ user_agent: `x\u0000${'y'.repeat(2000)}` });
    expect(out?.user_agent.length).toBe(512);
    expect(out?.user_agent.startsWith('xy')).toBe(true);
  });

  it('is null for nothing usable', () => {
    expect(sanitizeX402Metadata(undefined)).toBeNull();
    expect(sanitizeX402Metadata('str')).toBeNull();
    expect(sanitizeX402Metadata([1])).toBeNull();
    expect(sanitizeX402Metadata({ nope: 1 })).toBeNull();
  });
});
