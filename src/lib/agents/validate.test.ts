import { describe, expect, it } from 'vitest';
import { patchToRow, validateAgentInput, validateAgentPatch, validateLimit } from './validate';

const ADDRESS = '0x46E9322933cc873b40535f9574357A97adee6C79';

const base = { name: 'crawler', address: ADDRESS };

describe('validateLimit', () => {
  it('treats absent and null alike as no limit', () => {
    expect(validateLimit(undefined, 'x').value).toBeNull();
    expect(validateLimit(null, 'x').value).toBeNull();
  });

  it('refuses zero, and says what to do instead', () => {
    // Zero would otherwise read as "unlimited" further down, which is the
    // opposite of what someone typing it means.
    const result = validateLimit(0, 'dailyLimitUsd');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pause it instead/);
  });

  it('refuses a negative limit', () => {
    expect(validateLimit(-1, 'x').ok).toBe(false);
  });

  it('refuses NaN and Infinity', () => {
    expect(validateLimit(Number.NaN, 'x').ok).toBe(false);
    expect(validateLimit(Number.POSITIVE_INFINITY, 'x').ok).toBe(false);
  });

  it('refuses fractions of a cent the column cannot hold', () => {
    expect(validateLimit(1.234, 'x').ok).toBe(false);
    expect(validateLimit(1.23, 'x').ok).toBe(true);
  });

  it('refuses a value past what numeric(12,2) holds', () => {
    expect(validateLimit(10_000_000_000, 'x').ok).toBe(false);
  });
});

describe('validateAgentInput', () => {
  it('accepts a minimal agent and folds the address', () => {
    const result = validateAgentInput(base);
    expect(result.ok).toBe(true);
    expect(result.value!.address).toBe(ADDRESS.toLowerCase());
    expect(result.value!.status).toBe('active');
    expect(result.value!.dailyLimitUsd).toBeNull();
  });

  it('requires a name and an address', () => {
    expect(validateAgentInput({ address: ADDRESS }).error).toMatch(/name is required/);
    expect(validateAgentInput({ name: 'x' }).error).toMatch(/address is required/);
    expect(validateAgentInput({ ...base, name: '   ' }).error).toMatch(/name is required/);
  });

  it('refuses anything that is not an EVM address', () => {
    expect(validateAgentInput({ ...base, address: '0x123' }).ok).toBe(false);
    expect(validateAgentInput({ ...base, address: 'not-an-address' }).ok).toBe(false);
    // A Solana address is the realistic mistake, and it is the right length to
    // look plausible.
    expect(
      validateAgentInput({ ...base, address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK' }).ok,
    ).toBe(false);
  });

  it('refuses a limit that could never apply', () => {
    // A $50 per-payment ceiling under a $10 day is unreachable, so the operator
    // has written a rule that does nothing and probably believes otherwise.
    expect(
      validateAgentInput({ ...base, perPaymentLimitUsd: 50, dailyLimitUsd: 10 }).error,
    ).toMatch(/could never apply/);
    expect(validateAgentInput({ ...base, dailyLimitUsd: 500, totalLimitUsd: 100 }).error).toMatch(
      /could never apply/,
    );
  });

  it('accepts limits that nest properly', () => {
    const result = validateAgentInput({
      ...base,
      perPaymentLimitUsd: 1,
      dailyLimitUsd: 10,
      totalLimitUsd: 100,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a status it does not know', () => {
    expect(validateAgentInput({ ...base, status: 'disabled' }).ok).toBe(false);
  });

  it('refuses a body that is not an object', () => {
    expect(validateAgentInput(null).ok).toBe(false);
    expect(validateAgentInput('agent').ok).toBe(false);
  });
});

describe('validateAgentPatch', () => {
  it('tells an absent limit apart from one explicitly cleared', () => {
    // This is the whole reason a PATCH is checked on key presence: both arrive
    // as undefined once destructured, and they mean opposite things.
    expect(validateAgentPatch({ name: 'x' }).value).toEqual({ name: 'x' });
    expect(validateAgentPatch({ dailyLimitUsd: null }).value).toEqual({ dailyLimitUsd: null });
  });

  it('refuses an empty patch rather than doing nothing quietly', () => {
    expect(validateAgentPatch({}).error).toMatch(/Nothing to update/);
  });

  it('carries a status change through', () => {
    expect(validateAgentPatch({ status: 'paused' }).value).toEqual({ status: 'paused' });
  });

  it('applies the same limit rules as creation', () => {
    expect(validateAgentPatch({ dailyLimitUsd: 0 }).ok).toBe(false);
    expect(validateAgentPatch({ dailyLimitUsd: 1.005 }).ok).toBe(false);
  });

  it('ignores keys it does not know rather than writing them', () => {
    const result = validateAgentPatch({ name: 'x', businessId: 'someone-elses' });
    expect(result.value).toEqual({ name: 'x' });
  });
});

describe('patchToRow', () => {
  it('maps every field to its column and stamps updated_at', () => {
    const row = patchToRow({ name: 'x', status: 'paused', dailyLimitUsd: 10 });
    expect(row.name).toBe('x');
    expect(row.status).toBe('paused');
    expect(row.daily_limit_usd).toBe(10);
    expect(typeof row.updated_at).toBe('string');
  });

  it('writes a cleared limit as null rather than dropping it', () => {
    const row = patchToRow({ totalLimitUsd: null });
    expect('total_limit_usd' in row).toBe(true);
    expect(row.total_limit_usd).toBeNull();
  });
});
