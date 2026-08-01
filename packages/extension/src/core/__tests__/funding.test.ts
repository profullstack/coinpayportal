/**
 * A short balance is the failure mode that hides best: the run starts, and each
 * payment dies with a chain-level error ("No UTXOs available", "Transaction
 * simulation failed") that never says the word "balance". These pin down what
 * the approval screen is told, so the user sees it before approving.
 */

import { describe, it, expect } from 'vitest';
import { computeFunding } from '../batch.js';
import type { BatchPaymentRequest } from '../batch.js';

const SOL_SENDER = { address: 'SoLSenderAddress1111111111111111111111111', index: 0 };
const BTC_SENDER = { address: '14s74H7UHi68aGFxKQD2enMYmBKVFjVRFs', index: 0 };

function payment(over: Partial<BatchPaymentRequest> = {}): BatchPaymentRequest {
  return { id: 'inv-1', chain: 'SOL', to: 'recipient', amount: '1', ...over };
}

describe('computeFunding', () => {
  it('sums a chain across payments and compares against the funding address', () => {
    const funding = computeFunding(
      [payment({ id: 'a', amount: '0.5' }), payment({ id: 'b', amount: '0.25' })],
      { SOL: SOL_SENDER },
      [{ chain: 'SOL', address: SOL_SENDER.address, balance: '2' }],
    );

    expect(funding).toEqual([
      { chain: 'SOL', address: SOL_SENDER.address, required: '0.75', available: '2', sufficient: true },
    ]);
  });

  it('flags a run the paying address cannot cover', () => {
    const funding = computeFunding(
      [payment({ amount: '5' })],
      { SOL: SOL_SENDER },
      [{ chain: 'SOL', address: SOL_SENDER.address, balance: '0.01' }],
    );

    expect(funding[0]?.sufficient).toBe(false);
  });

  // The bug this is really for: a wallet holds several addresses per chain and
  // the batch spends exactly one. Counting the others makes an empty sender
  // look funded, which is precisely the report we could not explain.
  it('ignores balances held on the wallet\'s other addresses', () => {
    const funding = computeFunding(
      [payment({ amount: '1' })],
      { SOL: SOL_SENDER },
      [
        { chain: 'SOL', address: SOL_SENDER.address, balance: '0' },
        { chain: 'SOL', address: 'SomeOtherAddressWithAllTheMoney2222222222', balance: '100' },
      ],
    );

    expect(funding[0]).toMatchObject({ available: '0', sufficient: false });
  });

  it('keeps chains separate', () => {
    const funding = computeFunding(
      [payment({ id: 'a', chain: 'SOL', amount: '1' }), payment({ id: 'b', chain: 'BTC', amount: '0.5' })],
      { SOL: SOL_SENDER, BTC: BTC_SENDER },
      [
        { chain: 'SOL', address: SOL_SENDER.address, balance: '10' },
        { chain: 'BTC', address: BTC_SENDER.address, balance: '0' },
      ],
    );

    expect(funding.find((f) => f.chain === 'SOL')?.sufficient).toBe(true);
    expect(funding.find((f) => f.chain === 'BTC')?.sufficient).toBe(false);
  });

  it('treats a chain with no balance row as empty rather than unknown', () => {
    const funding = computeFunding([payment({ amount: '1' })], { SOL: SOL_SENDER }, []);
    expect(funding[0]).toMatchObject({ available: '0', sufficient: false });
  });

  it('does not credit a token balance to its base chain', () => {
    // USDC_SOL rides on the SOL address but is not SOL, and spending SOL needs SOL.
    const funding = computeFunding(
      [payment({ chain: 'SOL', amount: '1' })],
      { SOL: SOL_SENDER },
      [{ chain: 'USDC_SOL', address: SOL_SENDER.address, balance: '500' }],
    );

    expect(funding[0]).toMatchObject({ available: '0', sufficient: false });
  });

  it('survives malformed amounts and balances without producing NaN', () => {
    const funding = computeFunding(
      [payment({ amount: 'not-a-number' })],
      { SOL: SOL_SENDER },
      [{ chain: 'SOL', address: SOL_SENDER.address, balance: undefined }],
    );

    expect(funding[0]?.required).toBe('0');
    expect(funding[0]?.available).toBe('0');
  });
});
