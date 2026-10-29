/**
 * The Solana fee payer lives on change branch 1, so the payment-address
 * counter (m/44'/501'/i'/0') can never hand it to a customer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { deriveSolanaFeePayer, deriveSystemPaymentAddress, SOLANA_FEE_PAYER_DERIVATION_PATH } from './system-wallet';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('deriveSolanaFeePayer', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, SYSTEM_MNEMONIC_SOL: TEST_MNEMONIC }; });
  afterEach(() => { process.env = originalEnv; });

  it('sits outside every payment-address path', async () => {
    expect(SOLANA_FEE_PAYER_DERIVATION_PATH).toBe("m/44'/501'/0'/1'");
    const feePayer = await deriveSolanaFeePayer();
    for (let i = 0; i < 20; i++) {
      const payment = await deriveSystemPaymentAddress('SOL', i);
      expect(payment.address).not.toBe(feePayer.address);
    }
  });

  it('returns a key that signs for its own address', async () => {
    const feePayer = await deriveSolanaFeePayer();
    const seed = Uint8Array.from(Buffer.from(feePayer.privateKey, 'hex'));
    expect(Keypair.fromSeed(seed).publicKey.toBase58()).toBe(feePayer.address);
  });

  it('throws when the SOL mnemonic is not configured', async () => {
    delete process.env.SYSTEM_MNEMONIC_SOL;
    await expect(deriveSolanaFeePayer()).rejects.toThrow();
  });
});
