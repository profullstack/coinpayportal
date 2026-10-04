/**
 * Spendable-balance math for the web wallet.
 *
 * A transfer draws from ONE address, but the asset screen shows the sum of
 * every derived address on the chain. That gap is why a wallet reading $21
 * could refuse a $10 send: the money sat on a sibling address while the form
 * defaulted to the oldest one. These helpers let the send form and the prepare
 * endpoint share one definition of "can this address afford this", and say
 * what is missing when it cannot.
 *
 * Pure functions only — no network calls, no server-only imports — so the
 * client form and the API route can both import them.
 */

import type { WalletChain } from './identity';

/**
 * Minimum balance a zero-data Solana account must hold to stay rent-exempt.
 *
 * The runtime's rent-state check rejects a transfer that would leave the sender
 * holding less than this yet more than nothing, so the only two legal outcomes
 * for a near-full send are "leave at least this much behind" or "drain the
 * account to exactly zero". Without this check the chain's verdict arrives
 * after the payer has already typed their password and signed.
 */
export const SOL_RENT_EXEMPT_LAMPORTS = 890_880n;

/** Decimal places each chain's display unit carries. */
const CHAIN_DECIMALS: Record<WalletChain, number> = {
  BTC: 8,
  BCH: 8,
  DOGE: 8,
  ETH: 18,
  POL: 18,
  BNB: 18,
  SOL: 9,
  XRP: 6,
  ADA: 6,
  LN: 8,
  USDC_ETH: 6,
  USDC_POL: 6,
  USDC_SOL: 6,
  USDC_BASE: 6,
  USDT_ETH: 6,
  USDT_POL: 6,
  USDT_SOL: 6,
};

/** Ticker shown to the payer for each chain's spendable unit. */
const CHAIN_UNIT: Record<WalletChain, string> = {
  BTC: 'BTC',
  BCH: 'BCH',
  DOGE: 'DOGE',
  ETH: 'ETH',
  POL: 'POL',
  BNB: 'BNB',
  SOL: 'SOL',
  XRP: 'XRP',
  ADA: 'ADA',
  LN: 'BTC',
  USDC_ETH: 'USDC',
  USDC_POL: 'USDC',
  USDC_SOL: 'USDC',
  USDC_BASE: 'USDC',
  USDT_ETH: 'USDT',
  USDT_POL: 'USDT',
  USDT_SOL: 'USDT',
};

/**
 * True when the network fee comes out of the same balance being sent.
 *
 * A token transfer pays its fee in the parent chain's coin, so the fee must not
 * be subtracted from the token balance — doing so is how a wallet ends up
 * refusing a transfer of the payer's entire USDC balance.
 */
export function feeSharesBalance(chain: WalletChain): boolean {
  return !isTokenChain(chain);
}

/** True for the SPL / ERC-20 stablecoin chains. */
export function isTokenChain(chain: WalletChain): boolean {
  return chain.startsWith('USDC_') || chain.startsWith('USDT_');
}

/** Decimal places for a chain's display unit. */
export function chainDecimals(chain: WalletChain): number {
  return CHAIN_DECIMALS[chain] ?? 8;
}

/** The ticker a payer sees for what this chain spends. */
export function chainUnit(chain: WalletChain): string {
  return CHAIN_UNIT[chain] ?? chain;
}

/**
 * Parse a decimal amount into the chain's smallest unit.
 *
 * Amounts reach us as whatever `Number.prototype.toString` produced, which for
 * a small fiat-derived amount can be exponential ("8.58e-7"), so plain
 * `parseFloat` comparisons are not enough. Returns null for anything that is
 * not a finite decimal number. Digits past `decimals` are truncated, never
 * rounded up, so parsing can never invent value the payer does not have.
 */
export function toUnits(value: string | number, decimals: number): bigint | null {
  const raw = typeof value === 'number' ? value.toString() : (value ?? '').trim();
  if (!raw) return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(raw)) return null;

  const [mantissa, expPart] = raw.toLowerCase().split('e');
  const exp = expPart ? parseInt(expPart, 10) : 0;

  let digits = mantissa;
  let negative = false;
  if (digits.startsWith('-')) {
    negative = true;
    digits = digits.slice(1);
  } else if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }

  const dot = digits.indexOf('.');
  let intPart = dot === -1 ? digits : digits.slice(0, dot);
  let fracPart = dot === -1 ? '' : digits.slice(dot + 1);
  if (intPart === '') intPart = '0';

  // Fold the exponent in by moving the decimal point.
  if (exp > 0) {
    const take = Math.min(exp, fracPart.length);
    intPart += fracPart.slice(0, take) + '0'.repeat(exp - take);
    fracPart = fracPart.slice(take);
  } else if (exp < 0) {
    const shift = -exp;
    const take = Math.min(shift, intPart.length);
    fracPart =
      '0'.repeat(shift - take) + intPart.slice(intPart.length - take) + fracPart;
    intPart = intPart.slice(0, intPart.length - take) || '0';
  }

  fracPart =
    fracPart.length > decimals
      ? fracPart.slice(0, decimals)
      : fracPart.padEnd(decimals, '0');

  const units = BigInt(intPart + fracPart);
  return negative ? -units : units;
}

/**
 * Render smallest-unit value back as a decimal string, trailing zeros trimmed.
 */
export function formatUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  const text = frac ? `${whole}.${frac}` : whole.toString();
  return negative ? `-${text}` : text;
}

/** Format a smallest-unit value with its ticker, for a payer-facing message. */
function withUnit(units: bigint, chain: WalletChain): string {
  return `${formatUnits(units, chainDecimals(chain))} ${chainUnit(chain)}`;
}

export interface SpendableInput {
  chain: WalletChain;
  /** Balance of the *sending* address, in the chain's display unit. */
  balance: string;
  /** Amount to send, in the chain's display unit. */
  amount: string;
  /** Network fee in the chain's native currency. Optional for token chains. */
  fee?: string;
}

export type SpendableVerdict =
  | { ok: true }
  | {
      ok: false;
      code: 'INVALID_AMOUNT' | 'INSUFFICIENT_BALANCE' | 'RENT_FLOOR';
      message: string;
    };

/**
 * Decide whether one address can fund one transfer, and explain any shortfall.
 *
 * Lightning is exempt: its balance lives in LNbits rather than on a derived
 * address, so this per-address arithmetic does not describe it.
 */
export function checkSpendable(input: SpendableInput): SpendableVerdict {
  const { chain } = input;
  if (chain === 'LN') return { ok: true };

  const decimals = chainDecimals(chain);
  const amount = toUnits(input.amount, decimals);
  if (amount === null || amount <= 0n) {
    return { ok: false, code: 'INVALID_AMOUNT', message: 'Amount must be greater than 0' };
  }

  const balance = toUnits(input.balance, decimals) ?? 0n;
  const fee = feeSharesBalance(chain) ? toUnits(input.fee ?? '0', decimals) ?? 0n : 0n;
  const required = amount + fee;

  if (required > balance) {
    const shortfall = required - balance;
    const message =
      fee > 0n
        ? `This address holds ${withUnit(balance, chain)}. Sending ${withUnit(amount, chain)} ` +
          `plus a ${withUnit(fee, chain)} network fee needs ${withUnit(required, chain)} — ` +
          `${withUnit(shortfall, chain)} more than it has.`
        : `This address holds ${withUnit(balance, chain)}, which is ` +
          `${withUnit(shortfall, chain)} short of the ${withUnit(amount, chain)} you are sending.`;
    return { ok: false, code: 'INSUFFICIENT_BALANCE', message };
  }

  // Solana's rent-state check: leave nothing, or leave enough.
  if (chain === 'SOL') {
    const remaining = balance - required;
    if (remaining > 0n && remaining < SOL_RENT_EXEMPT_LAMPORTS) {
      const below = balance - fee - SOL_RENT_EXEMPT_LAMPORTS;
      const drain = balance - fee;
      const message =
        `Solana rejects a transfer that leaves less than ` +
        `${withUnit(SOL_RENT_EXEMPT_LAMPORTS, chain)} behind. Send at most ` +
        `${withUnit(below > 0n ? below : 0n, chain)}, or exactly ` +
        `${withUnit(drain, chain)} to empty this address.`;
      return { ok: false, code: 'RENT_FLOOR', message };
    }
  }

  return { ok: true };
}

/**
 * The largest amount this address can actually send, as a decimal string.
 *
 * For SOL that is the full drain (balance minus fee): the rent floor bites only
 * on the amounts *between* it and a clean zero, so draining is legal where
 * leaving a dusty remainder is not.
 */
export function maxSpendable(input: {
  chain: WalletChain;
  balance: string;
  fee?: string;
}): string {
  const decimals = chainDecimals(input.chain);
  const balance = toUnits(input.balance, decimals) ?? 0n;
  const fee = feeSharesBalance(input.chain)
    ? toUnits(input.fee ?? '0', decimals) ?? 0n
    : 0n;
  const max = balance - fee;
  return formatUnits(max > 0n ? max : 0n, decimals);
}
