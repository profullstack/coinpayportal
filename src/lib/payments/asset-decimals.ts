/**
 * How many decimal places each asset can actually carry on its own chain.
 *
 * A quote is a promise the payer has to be able to keep exactly. USDC is a
 * six-decimal token, so `6.44064406 USDC` is not a smaller payment than the
 * invoice — it is an amount that cannot exist: the smallest unit the contract
 * can move is 0.000001. A wallet asked for it sends 6.440644, the monitor reads
 * 6.440644 against an expected 6.44064406, and the payment sits pending until
 * it expires with the customer's money sitting at the deposit address.
 *
 * That is not hypothetical: every USDC invoice on 2026-09-24 expired that way
 * (the monitor logged `balance=6.440644, expected=6.44064406` on a loop) while
 * SOL and BTC invoices in the same window settled, because eight decimals fits
 * inside their nine and eight.
 *
 * So the rate conversion is rounded to the ASSET's precision, not to a blanket
 * eight places, and the settlement check tolerates a shortfall smaller than one
 * atomic unit so quotes already written at the wrong precision can still be
 * paid.
 */

/**
 * Decimals per blockchain/currency code as the platform spells them — the same
 * keys used for `payments.blockchain` (`USDC_ETH`, `SOL`, `BTC`, …). Token
 * entries match the contracts in `monitor-balance.ts`; native entries match the
 * chain.
 */
const ASSET_DECIMALS: Record<string, number> = {
  // Native coins
  BTC: 8,
  BCH: 8,
  DOGE: 8,
  LTC: 8,
  ETH: 18,
  POL: 18,
  BNB: 18,
  BASE: 18,
  SOL: 9,
  XRP: 6,
  ADA: 6,
  // Stablecoins — six decimals on every chain we settle them on
  USDT: 6,
  USDT_ETH: 6,
  USDT_POL: 6,
  USDT_SOL: 6,
  USDC: 6,
  USDC_ETH: 6,
  USDC_POL: 6,
  USDC_SOL: 6,
  USDC_BASE: 6,
};

/**
 * The precision quotes have always been rounded to. Used for an asset we do not
 * have an entry for, because narrowing an unknown asset would be the dangerous
 * direction: too FEW decimals overcharges the payer, while too many only
 * reproduces the behaviour that was already there.
 */
export const DEFAULT_QUOTE_DECIMALS = 8;

/** Decimal places `asset` can represent on-chain. */
export function assetDecimals(asset: string | null | undefined): number {
  if (!asset) return DEFAULT_QUOTE_DECIMALS;
  return ASSET_DECIMALS[asset.toUpperCase()] ?? DEFAULT_QUOTE_DECIMALS;
}

/** The value of one atomic unit of `asset`, expressed in whole coins. */
export function atomicUnit(asset: string | null | undefined): number {
  return 10 ** -assetDecimals(asset);
}

/**
 * Round a quoted amount to something the payer's wallet can send exactly.
 *
 * Rounds UP: the payer is asked for at most one atomic unit more than the rate
 * produced, never less, so the quantisation can never leave the merchant short.
 * At six decimals of USDC that is a millionth of a dollar.
 *
 * The scaled value is snapped to the nearest integer first when it is already
 * one within floating-point noise — `0.05 * 1e6` is `50000.000000000007` in
 * IEEE-754, and a naive ceil would quote 0.050001 for it.
 */
export function quantizeQuote(amount: number, asset: string | null | undefined): number {
  if (!Number.isFinite(amount) || amount <= 0) return amount;

  const decimals = assetDecimals(asset);
  const scale = 10 ** decimals;
  const scaled = amount * scale;

  // Guard against both directions of representation error: a value that is a
  // whole number of atomic units stays put, anything else moves up one.
  const nearest = Math.round(scaled);
  const units = Math.abs(scaled - nearest) < 1e-6 ? nearest : Math.ceil(scaled);

  return units / scale;
}
