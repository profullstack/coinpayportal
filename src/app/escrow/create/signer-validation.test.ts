import { describe, it, expect } from 'vitest';
import { isEvmMultisigChain, validateMultisigSigner } from './signer-validation';

describe('isEvmMultisigChain', () => {
  it('recognizes EVM multisig chains', () => {
    for (const chain of ['ETH', 'POL', 'BASE', 'ARB', 'OP', 'BNB', 'AVAX']) {
      expect(isEvmMultisigChain(chain)).toBe(true);
    }
  });

  it('rejects non-EVM chains', () => {
    for (const chain of ['BTC', 'LTC', 'DOGE', 'SOL']) {
      expect(isEvmMultisigChain(chain)).toBe(false);
    }
  });
});

describe('validateMultisigSigner', () => {
  const validEvm = '0x1234567890abcdefABCDEF1234567890abcdef12';
  const validCompressedPubkey = '02' + 'a'.repeat(64);
  const validUncompressedPubkey = '04' + 'b'.repeat(128);
  const validSol = '11111111111111111111111111111111'; // 32 base58 chars

  it('requires a value', () => {
    expect(validateMultisigSigner('', 'ETH')).toBe('Required');
    expect(validateMultisigSigner('   ', 'ETH')).toBe('Required');
  });

  it('accepts a valid EVM signer address', () => {
    expect(validateMultisigSigner(validEvm, 'ETH')).toBeNull();
    expect(validateMultisigSigner(`  ${validEvm}  `, 'POL')).toBeNull();
  });

  it('rejects malformed EVM addresses', () => {
    expect(validateMultisigSigner('not-an-address', 'ETH')).toMatch(/0x/);
    expect(validateMultisigSigner('0x1234', 'ETH')).toMatch(/0x/);
    expect(validateMultisigSigner('0x5678', 'BASE')).toMatch(/0x/);
  });

  it('accepts valid UTXO public keys', () => {
    expect(validateMultisigSigner(validCompressedPubkey, 'BTC')).toBeNull();
    expect(validateMultisigSigner(validUncompressedPubkey, 'DOGE')).toBeNull();
  });

  it('rejects UTXO values that are not hex public keys', () => {
    expect(validateMultisigSigner('0x1234', 'BTC')).toMatch(/public key/i);
    expect(validateMultisigSigner('xyz', 'LTC')).toMatch(/public key/i);
  });

  it('accepts a valid Solana base58 public key', () => {
    expect(validateMultisigSigner(validSol, 'SOL')).toBeNull();
  });

  it('rejects invalid Solana keys', () => {
    expect(validateMultisigSigner('not-a-valid-solana-key-!!!', 'SOL')).toMatch(/Solana/i);
  });
});
