import { describe, it, expect } from 'vitest';
import { checkSpamSignup } from './spam-detection';

describe('Spam Detection Heuristics', () => {
  it('should not block a legitimate registration when name is provided and timing is normal', () => {
    const result = checkSpamSignup({
      name: 'Alice Smith',
      email: 'alice@example.com',
      registrationStartMs: Date.now() - 5000, // 5 seconds elapsed
    });
    expect(result.blocked).toBe(false);
    expect(result.score).toBeLessThan(50);
  });

  it('should block when honeypot is filled', () => {
    const result = checkSpamSignup({
      name: 'Alice Smith',
      email: 'alice@example.com',
      honeypot: 'some-bot-value',
      registrationStartMs: Date.now() - 5000,
    });
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain('honeypot_filled');
  });

  it('BUG DEMO: should block legitimate user who does not provide name and registers fast', () => {
    const result = checkSpamSignup({
      name: '', // optional name left blank
      email: 'john.doe@example.com',
      registrationStartMs: Date.now() - 1500, // submits in 1.5s (e.g. browser autofill)
    });
    // This currently fails/blocks legitimate user
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain('too_fast');
    expect(result.reasons).toContain('no_name');
  });

  it('BUG DEMO: should block legitimate user when client clock is ahead of server clock (negative elapsed)', () => {
    const result = checkSpamSignup({
      name: 'John Doe',
      email: 'john.doe@example.com',
      registrationStartMs: Date.now() + 5000, // client clock is 5s ahead of server clock
    });
    // elapsed will be -5000, which is < 2000, triggering 'too_fast'
    // Even if name is provided, if other factors like dotted gmail or similar trigger, it can block.
    // If no name is provided:
    const resultNoName = checkSpamSignup({
      name: '',
      email: 'john.doe@example.com',
      registrationStartMs: Date.now() + 5000,
    });
    expect(resultNoName.reasons).toContain('too_fast');
    expect(resultNoName.blocked).toBe(true);
  });
});
