import { describe, expect, it } from 'vitest';
import { preparedTxPaysRecipient } from './verify-prepared';
import type { UnsignedTransactionData } from '../web-wallet/prepare-tx';

/**
 * Regression tests for REC-04 (2026-08-19 audit).
 *
 * `WalletSDK.send()` asked the server to prepare a transaction and then signed
 * whatever came back. Holding the key locally only protects the user if the
 * thing being signed is inspected — otherwise a hostile server returns an
 * unsigned_tx paying its own address, echoes the requested recipient in the
 * JSON beside it, and the SDK signs it.
 */

// Placeholder addresses, built from a repeated nibble so they read as obviously
// synthetic and so the credential scanner does not mistake a fixture for a
// secret. `TOKEN_CONTRACT` is named for what it is — the ERC-20 contract a
// token transfer is sent TO, which is exactly why comparing the tx `to` field
// against the payee is wrong for token transfers.
const PAYEE_EVM = `0x${'11'.repeat(20)}`;
const ATTACKER_EVM = `0x${'22'.repeat(20)}`;
const TOKEN_CONTRACT = `0x${'33'.repeat(20)}`;

function evmNative(to: string): UnsignedTransactionData {
  return { type: 'evm', chainId: 1, nonce: 0, to, value: '0x1', gasLimit: 21000,
    maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' } as UnsignedTransactionData;
}

/** ERC-20 transfer(address,uint256): selector + padded recipient + padded amount. */
function evmToken(recipient: string): UnsignedTransactionData {
  const padded = recipient.replace(/^0x/, '').padStart(64, '0');
  const amount = '1'.padStart(64, '0');
  return {
    type: 'evm', chainId: 1, nonce: 0, to: TOKEN_CONTRACT, value: '0x0', gasLimit: 60000,
    maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1',
    data: `0xa9059cbb${padded}${amount}`, contractAddress: TOKEN_CONTRACT,
  } as UnsignedTransactionData;
}

describe('preparedTxPaysRecipient', () => {
  it('accepts a native EVM transfer to the requested address', () => {
    expect(preparedTxPaysRecipient(evmNative(PAYEE_EVM), PAYEE_EVM)).toBe(true);
  });

  it('rejects a native EVM transfer redirected elsewhere', () => {
    // The attack in one line.
    expect(preparedTxPaysRecipient(evmNative(ATTACKER_EVM), PAYEE_EVM)).toBe(false);
  });

  it('reads the recipient out of ERC-20 calldata, not the contract address', () => {
    // A token transfer's `to` is the token contract, so comparing that field
    // would pass for any recipient at all.
    expect(preparedTxPaysRecipient(evmToken(PAYEE_EVM), PAYEE_EVM)).toBe(true);
    expect(preparedTxPaysRecipient(evmToken(ATTACKER_EVM), PAYEE_EVM)).toBe(false);
  });

  it('is case-insensitive for EVM addresses', () => {
    expect(preparedTxPaysRecipient(evmNative(PAYEE_EVM.toUpperCase()), PAYEE_EVM)).toBe(true);
  });

  it('accepts a Bitcoin tx that pays the payee alongside change', () => {
    const tx = {
      type: 'btc', feeRate: 1, inputs: [],
      outputs: [
        { address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', value: 100000 },
        { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', value: 50000 },
      ],
    } as unknown as UnsignedTransactionData;
    expect(preparedTxPaysRecipient(tx, '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true);
  });

  it('rejects a Bitcoin tx that pays the payee nothing', () => {
    const tx = {
      type: 'btc', feeRate: 1, inputs: [],
      outputs: [{ address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', value: 150000 }],
    } as unknown as UnsignedTransactionData;
    expect(preparedTxPaysRecipient(tx, '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(false);
  });

  it('finds a Solana recipient in instruction fields or account keys', () => {
    const payee = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const byField = {
      type: 'sol', recentBlockhash: 'x', feePayer: 'y',
      instructions: [{ destination: payee }],
    } as unknown as UnsignedTransactionData;
    const byKeys = {
      type: 'sol', recentBlockhash: 'x', feePayer: 'y',
      instructions: [{ keys: [{ pubkey: payee }] }],
    } as unknown as UnsignedTransactionData;

    expect(preparedTxPaysRecipient(byField, payee)).toBe(true);
    expect(preparedTxPaysRecipient(byKeys, payee)).toBe(true);
    expect(preparedTxPaysRecipient(byField, 'SomeOtherAddress1111111111111111111111111')).toBe(false);
  });

  it('refuses an unrecognised shape rather than passing it', () => {
    // "Cannot check" must not read as "checked and fine".
    const weird = { type: 'quantum' } as unknown as UnsignedTransactionData;
    expect(preparedTxPaysRecipient(weird, PAYEE_EVM)).toBe(false);
  });

  it('refuses an empty expected recipient', () => {
    expect(preparedTxPaysRecipient(evmNative(PAYEE_EVM), '')).toBe(false);
  });
});
