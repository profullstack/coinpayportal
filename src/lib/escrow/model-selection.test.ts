import { describe, it, expect } from 'vitest';
import {
  selectEscrowModel,
  explainEscrowModel,
  isMultisigSupportedChain,
  MULTISIG_SUPPORTED_CHAINS,
} from './model-selection';

/** Multisig on, and preferred — the configuration this logic exists for. */
const ON = { multisigEnabled: true, multisigDefault: true };
/** Production today: the feature flag is unset. */
const OFF = { multisigEnabled: false, multisigDefault: true };

describe('isMultisigSupportedChain', () => {
  it('accepts native coins', () => {
    expect(isMultisigSupportedChain('BTC')).toBe(true);
    expect(isMultisigSupportedChain('ETH')).toBe(true);
    expect(isMultisigSupportedChain('SOL')).toBe(true);
  });

  it('rejects stablecoins, which the multisig adapters do not implement', () => {
    expect(isMultisigSupportedChain('USDC_POL')).toBe(false);
    expect(isMultisigSupportedChain('USDT_ETH')).toBe(false);
    expect(isMultisigSupportedChain('USDC')).toBe(false);
  });

  it('exposes the supported set without stablecoins', () => {
    expect(MULTISIG_SUPPORTED_CHAINS).toContain('BTC');
    expect(MULTISIG_SUPPORTED_CHAINS.some((c) => c.startsWith('USD'))).toBe(false);
  });
});

describe('selectEscrowModel — default resolution', () => {
  it('defaults to multisig on a supported chain', () => {
    const result = selectEscrowModel({ chain: 'ETH', ...ON });
    expect(result).toEqual({ ok: true, model: 'multisig_2of3', reason: 'multisig-default' });
  });

  it('falls back to custodial for stablecoins', () => {
    const result = selectEscrowModel({ chain: 'USDC_POL', ...ON });
    expect(result).toEqual({ ok: true, model: 'custodial', reason: 'chain-unsupported' });
  });

  it('falls back to custodial for recurring series', () => {
    const result = selectEscrowModel({ chain: 'ETH', recurring: true, ...ON });
    expect(result).toEqual({ ok: true, model: 'custodial', reason: 'recurring-unsupported' });
  });

  it('falls back to custodial when multisig is disabled', () => {
    const result = selectEscrowModel({ chain: 'ETH', ...OFF });
    expect(result).toEqual({ ok: true, model: 'custodial', reason: 'multisig-disabled' });
  });

  it('falls back to custodial when multisig is enabled but not the default', () => {
    const result = selectEscrowModel({
      chain: 'ETH',
      multisigEnabled: true,
      multisigDefault: false,
    });
    expect(result).toEqual({ ok: true, model: 'custodial', reason: 'multisig-not-default' });
  });

  it('never fails to resolve a model when none was requested', () => {
    for (const chain of ['ETH', 'USDC_POL', 'DOGE', 'nonsense']) {
      for (const flags of [ON, OFF]) {
        const result = selectEscrowModel({ chain, ...flags });
        expect(result.ok).toBe(true);
      }
    }
  });
});

describe('selectEscrowModel — explicit requests are never silently downgraded', () => {
  it('errors rather than downgrading when multisig is disabled', () => {
    const result = selectEscrowModel({ requested: 'multisig_2of3', chain: 'ETH', ...OFF });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not enabled/i);
  });

  it('errors rather than downgrading on an unsupported chain', () => {
    const result = selectEscrowModel({ requested: 'multisig_2of3', chain: 'USDC_POL', ...ON });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not support USDC_POL/);
  });

  it('errors rather than downgrading for a recurring series', () => {
    const result = selectEscrowModel({
      requested: 'multisig_2of3',
      chain: 'ETH',
      recurring: true,
      ...ON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/recurring/i);
  });

  it('honours an explicit multisig request when it is viable', () => {
    const result = selectEscrowModel({ requested: 'multisig_2of3', chain: 'BTC', ...ON });
    expect(result).toEqual({ ok: true, model: 'multisig_2of3', reason: 'explicit' });
  });

  it('honours an explicit custodial request even when multisig is the default', () => {
    const result = selectEscrowModel({ requested: 'custodial', chain: 'ETH', ...ON });
    expect(result).toEqual({ ok: true, model: 'custodial', reason: 'explicit' });
  });
});

describe('explainEscrowModel', () => {
  it('says CoinPay cannot act alone for multisig', () => {
    expect(explainEscrowModel('multisig_2of3', 'multisig-default')).toMatch(/cannot move funds alone/);
  });

  it('always states that CoinPay holds the funds for every custodial outcome', () => {
    const reasons = [
      'explicit',
      'multisig-disabled',
      'multisig-not-default',
      'chain-unsupported',
      'recurring-unsupported',
    ] as const;
    for (const reason of reasons) {
      expect(explainEscrowModel('custodial', reason)).toMatch(/CoinPay holds these funds/);
    }
  });

  it('explains why a fallback happened rather than just asserting custody', () => {
    expect(explainEscrowModel('custodial', 'chain-unsupported')).toMatch(/stablecoins are not supported/i);
    expect(explainEscrowModel('custodial', 'multisig-disabled')).toMatch(/not enabled/i);
  });
});
