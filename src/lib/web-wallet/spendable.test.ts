import { describe, it, expect } from 'vitest';
import {
  checkSpendable,
  maxSpendable,
  toUnits,
  formatUnits,
  chainDecimals,
  isTokenChain,
  feeSharesBalance,
  SOL_RENT_EXEMPT_LAMPORTS,
} from './spendable';

/** Fee the SOL estimator returns for a single-signature transfer. */
const SOL_FEE = '0.000005';

describe('toUnits', () => {
  it('parses a plain decimal at the chain scale', () => {
    expect(toUnits('0.18134693', 9)).toBe(181346930n);
    expect(toUnits('1', 9)).toBe(1_000_000_000n);
    expect(toUnits('0', 9)).toBe(0n);
  });

  it('parses exponential notation, which small fiat-derived amounts produce', () => {
    // (0.0000001).toString() === '1e-7'
    expect(toUnits('1e-7', 9)).toBe(100n);
    expect(toUnits('8.58e-5', 9)).toBe(85_800n);
    expect(toUnits('1.5e3', 9)).toBe(1_500_000_000_000n);
  });

  it('truncates rather than rounds past the chain scale', () => {
    // Rounding up here would invent value the payer does not hold.
    expect(toUnits('0.1234567899', 9)).toBe(123_456_789n);
  });

  it('handles 18-decimal chains without float loss', () => {
    expect(toUnits('0.1', 18)).toBe(100_000_000_000_000_000n);
  });

  it('rejects anything that is not a finite decimal', () => {
    expect(toUnits('', 9)).toBeNull();
    expect(toUnits('abc', 9)).toBeNull();
    expect(toUnits('0.1.2', 9)).toBeNull();
    expect(toUnits('NaN', 9)).toBeNull();
    expect(toUnits('Infinity', 9)).toBeNull();
  });
});

describe('formatUnits', () => {
  it('round-trips and trims trailing zeros', () => {
    expect(formatUnits(181_346_930n, 9)).toBe('0.18134693');
    expect(formatUnits(1_000_000_000n, 9)).toBe('1');
    expect(formatUnits(0n, 9)).toBe('0');
    expect(formatUnits(5_000n, 9)).toBe('0.000005');
  });
});

describe('chain metadata', () => {
  it('knows which chains pay fees out of the balance being sent', () => {
    expect(feeSharesBalance('SOL')).toBe(true);
    expect(feeSharesBalance('ETH')).toBe(true);
    // An SPL/ERC-20 fee is paid in the parent chain's coin.
    expect(feeSharesBalance('USDC_SOL')).toBe(false);
    expect(isTokenChain('USDT_POL')).toBe(true);
    expect(isTokenChain('BTC')).toBe(false);
    expect(chainDecimals('SOL')).toBe(9);
    expect(chainDecimals('USDC_SOL')).toBe(6);
  });
});

describe('checkSpendable — the reported failure', () => {
  // The wallet screen showed 0.18134693 SOL ($21.13) as the chain total, but
  // that was the sum of two derived addresses: 0.00560124 on the one the form
  // preselected and 0.17574569 on its sibling. $10 was ~0.08583 SOL.
  const TEN_DOLLARS_OF_SOL = '0.08583';

  it('rejects the send from the near-empty address and names the shortfall', () => {
    const verdict = checkSpendable({
      chain: 'SOL',
      balance: '0.00560124',
      amount: TEN_DOLLARS_OF_SOL,
      fee: SOL_FEE,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('INSUFFICIENT_BALANCE');
    expect(verdict.message).toContain('0.00560124 SOL');
    expect(verdict.message).toContain('0.08583 SOL');
    // balance 0.00560124, required 0.085835 → short 0.08023376
    expect(verdict.message).toContain('0.08023376 SOL');
  });

  it('allows the same send from the funded sibling address', () => {
    expect(
      checkSpendable({
        chain: 'SOL',
        balance: '0.17574569',
        amount: TEN_DOLLARS_OF_SOL,
        fee: SOL_FEE,
      })
    ).toEqual({ ok: true });
  });

  it('does not accept the aggregate balance as cover for one address', () => {
    // Guards the actual defect: summing every derived address made the send
    // look affordable when no single keypair could fund it.
    const total = checkSpendable({
      chain: 'SOL',
      balance: '0.18134693',
      amount: TEN_DOLLARS_OF_SOL,
      fee: SOL_FEE,
    });
    expect(total).toEqual({ ok: true });
    const perAddress = checkSpendable({
      chain: 'SOL',
      balance: '0.00560124',
      amount: TEN_DOLLARS_OF_SOL,
      fee: SOL_FEE,
    });
    expect(perAddress.ok).toBe(false);
  });
});

describe('checkSpendable — fee accounting', () => {
  it('counts the fee against a native balance', () => {
    // Exactly the balance, so the fee is what pushes it over.
    const verdict = checkSpendable({
      chain: 'SOL',
      balance: '1',
      amount: '1',
      fee: SOL_FEE,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('INSUFFICIENT_BALANCE');
    expect(verdict.message).toContain('network fee');
  });

  it('does not charge a token balance for a native-coin fee', () => {
    // Sending an entire USDC balance must be allowed: the fee is SOL.
    expect(
      checkSpendable({
        chain: 'USDC_SOL',
        balance: '25.5',
        amount: '25.5',
        fee: SOL_FEE,
      })
    ).toEqual({ ok: true });
  });

  it('still catches a token amount above the token balance', () => {
    const verdict = checkSpendable({
      chain: 'USDC_SOL',
      balance: '25.5',
      amount: '30',
      fee: SOL_FEE,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.message).toContain('4.5 USDC');
    expect(verdict.message).not.toContain('network fee');
  });
});

describe('checkSpendable — Solana rent floor', () => {
  it('rejects a send that leaves a sub-rent-exempt remainder', () => {
    // 0.1 SOL, leaving 0.0005 SOL (below the 0.00089088 floor) after fee.
    const verdict = checkSpendable({
      chain: 'SOL',
      balance: '0.1',
      amount: '0.099495',
      fee: SOL_FEE,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('RENT_FLOOR');
    expect(verdict.message).toContain('0.00089088 SOL');
    // The two legal options: stay under the floor, or drain to zero.
    expect(verdict.message).toContain('0.09910412 SOL');
    expect(verdict.message).toContain('0.099995 SOL');
  });

  it('offers two amounts that both pass the check it just failed', () => {
    // A rejection that suggests an amount the chain would also reject is worse
    // than no suggestion, so both branches are held to the check itself.
    const balance = '0.1';
    for (const amount of ['0.09910412', '0.099995']) {
      expect(checkSpendable({ chain: 'SOL', balance, amount, fee: SOL_FEE })).toEqual({
        ok: true,
      });
    }
  });

  it('accepts a remainder of exactly the rent-exempt minimum', () => {
    // 0.1 - 0.09910412 - 0.000005 === 0.00089088, the floor itself.
    expect(
      checkSpendable({ chain: 'SOL', balance: '0.1', amount: '0.09910412', fee: SOL_FEE })
    ).toEqual({ ok: true });
  });

  it('allows a full drain to exactly zero', () => {
    expect(
      checkSpendable({ chain: 'SOL', balance: '0.1', amount: '0.099995', fee: SOL_FEE })
    ).toEqual({ ok: true });
  });

  it('allows a send that leaves the floor intact', () => {
    expect(
      checkSpendable({ chain: 'SOL', balance: '0.1', amount: '0.09', fee: SOL_FEE })
    ).toEqual({ ok: true });
  });

  it('applies the floor only to SOL', () => {
    // The same dusty remainder is fine on an account-less chain.
    expect(
      checkSpendable({ chain: 'ETH', balance: '0.1', amount: '0.0999', fee: '0.00001' })
    ).toEqual({ ok: true });
  });

  it('uses the documented rent-exempt minimum', () => {
    expect(SOL_RENT_EXEMPT_LAMPORTS).toBe(890_880n);
  });
});

describe('checkSpendable — input guards', () => {
  it('rejects a zero or negative amount', () => {
    for (const amount of ['0', '-1', '']) {
      const verdict = checkSpendable({ chain: 'SOL', balance: '1', amount, fee: SOL_FEE });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('INVALID_AMOUNT');
    }
  });

  it('treats an unreadable balance as empty rather than as cover', () => {
    const verdict = checkSpendable({ chain: 'SOL', balance: 'n/a', amount: '1', fee: SOL_FEE });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('exempts Lightning, whose balance is not per-address', () => {
    expect(checkSpendable({ chain: 'LN', balance: '0', amount: '1' })).toEqual({ ok: true });
  });
});

describe('maxSpendable', () => {
  it('drains a SOL address to zero net of the fee', () => {
    expect(maxSpendable({ chain: 'SOL', balance: '0.17574569', fee: SOL_FEE })).toBe(
      '0.17574069'
    );
  });

  it('is the whole balance for a token, whose fee is native', () => {
    expect(maxSpendable({ chain: 'USDC_SOL', balance: '25.5', fee: SOL_FEE })).toBe('25.5');
  });

  it('never goes negative when the fee exceeds the balance', () => {
    expect(maxSpendable({ chain: 'SOL', balance: '0.000001', fee: SOL_FEE })).toBe('0');
  });

  it('produces an amount that checkSpendable accepts', () => {
    const balance = '0.17574569';
    const max = maxSpendable({ chain: 'SOL', balance, fee: SOL_FEE });
    expect(checkSpendable({ chain: 'SOL', balance, amount: max, fee: SOL_FEE })).toEqual({
      ok: true,
    });
  });
});
