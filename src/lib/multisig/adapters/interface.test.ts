/**
 * Chain Adapter Interface Tests
 *
 * Tests the adapter type resolution utility.
 */

import { describe, it, expect } from 'vitest';
import { getAdapterType } from './interface';

describe('getAdapterType', () => {
  it('should return "evm" for EVM chains', () => {
    expect(getAdapterType('ETH')).toBe('evm');
    expect(getAdapterType('POL')).toBe('evm');
    expect(getAdapterType('BASE')).toBe('evm');
    expect(getAdapterType('ARB')).toBe('evm');
    expect(getAdapterType('OP')).toBe('evm');
    expect(getAdapterType('BNB')).toBe('evm');
    expect(getAdapterType('AVAX')).toBe('evm');
  });

  it('should return "utxo" for UTXO chains', () => {
    expect(getAdapterType('BTC')).toBe('utxo');
    expect(getAdapterType('LTC')).toBe('utxo');
    expect(getAdapterType('DOGE')).toBe('utxo');
  });

  it('should return "solana" for SOL', () => {
    expect(getAdapterType('SOL')).toBe('solana');
  });

  it('should throw for unsupported chains', () => {
    expect(() => getAdapterType('XRP' as any)).toThrow('Unsupported multisig chain');
    expect(() => getAdapterType('ADA' as any)).toThrow('Unsupported multisig chain');
  });
});
