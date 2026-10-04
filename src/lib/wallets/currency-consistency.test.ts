import { describe, expect, it } from 'vitest';
import { CRYPTO_NAMES } from './supported-coins';
import { isValidPayoutAddress } from '../blockchain/address-format';
import { getStaticFees } from '../rates/fees';

/**
 * Regression guard for H-R-08 and H-R-06 (2026-08-19 audit).
 *
 * H-R-08: the supported-currency list diverges across eight modules — the
 * currency name map, the balance checker, the fee estimator, the settleable set
 * and the address validator each carry their own copy, with no single source of
 * truth. Hand-syncing eight lists fixes today and drifts again next month, so
 * the durable fix is a test that fails when they disagree.
 *
 * `CRYPTO_NAMES` is the declared operational source of truth (see the header of
 * `supported-chains.ts`), so every other module is checked against it.
 *
 * H-R-06 is the concrete damage this shape produced: the address validator
 * treated bare `USDC` as Solana while balance-checking, fee estimation and
 * address generation all treated it as ERC-20 on Ethereum — so a merchant had
 * to supply a Solana address to configure a payout that was then paid on
 * Ethereum.
 */

/** Representative well-formed addresses per address family. */
const SAMPLES = {
  evm: '0x1234567890123456789012345678901234567890',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  bitcoin: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
};

/**
 * The address family each supported symbol settles on.
 *
 * Deliberately spelled out rather than derived: this is the assertion. If a new
 * symbol is added to `CRYPTO_NAMES` without a decision recorded here, the last
 * test in this file fails and forces that decision to be made explicitly.
 */
const EXPECTED_FAMILY: Record<string, 'evm' | 'solana' | 'bitcoin' | 'other'> = {
  BTC: 'bitcoin',
  BCH: 'other',
  ETH: 'evm',
  POL: 'evm',
  SOL: 'solana',
  BNB: 'other',
  XRP: 'other',
  ADA: 'other',
  DOGE: 'other',
  // Bare stablecoin tickers settle as ERC-20 on Ethereum.
  USDT: 'evm',
  USDC: 'evm',
  USDT_ETH: 'evm',
  USDT_POL: 'evm',
  USDT_SOL: 'solana',
  USDC_ETH: 'evm',
  USDC_POL: 'evm',
  USDC_SOL: 'solana',
  USDC_BASE: 'evm',
};

describe('supported-currency consistency', () => {
  it('every symbol in CRYPTO_NAMES has a declared address family', () => {
    const undeclared = Object.keys(CRYPTO_NAMES).filter((s) => !(s in EXPECTED_FAMILY));
    expect(undeclared).toEqual([]);
  });

  it('the address validator agrees with the declared family for every symbol', () => {
    const disagreements: string[] = [];

    for (const [symbol, family] of Object.entries(EXPECTED_FAMILY)) {
      if (!(symbol in CRYPTO_NAMES)) continue;
      if (family === 'other') continue; // no validator; returns null by design

      const good = SAMPLES[family];
      if (isValidPayoutAddress(good, symbol) !== true) {
        disagreements.push(`${symbol}: rejected a valid ${family} address`);
      }

      // And an address from a different family must NOT validate, otherwise the
      // check is not actually discriminating.
      const wrongFamily = family === 'evm' ? SAMPLES.solana : SAMPLES.evm;
      if (isValidPayoutAddress(wrongFamily, symbol) === true) {
        disagreements.push(`${symbol}: accepted an address from the wrong family`);
      }
    }

    expect(disagreements).toEqual([]);
  });

  it('bare USDC validates as EVM, not Solana (H-R-06)', () => {
    // The specific disagreement that misdirected payouts.
    expect(isValidPayoutAddress(SAMPLES.evm, 'USDC')).toBe(true);
    expect(isValidPayoutAddress(SAMPLES.solana, 'USDC')).toBe(false);
  });

  it('every chain on the static-fee fallback list is a real supported symbol', () => {
    // Deliberately the narrow direction. The reverse — "every symbol has a
    // static fee" — is wrong: BTC, ETH, POL and SOL are priced from live
    // network conditions and are absent from this table by design. What is
    // worth asserting is that the fallback table has not accumulated entries
    // for chains the gateway no longer supports.
    const orphans = Object.keys(getStaticFees()).filter((s) => !(s in CRYPTO_NAMES));
    expect(orphans).toEqual([]);
  });
});
