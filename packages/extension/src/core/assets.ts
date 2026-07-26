/**
 * Turning a wallet's address balances into the asset rows the popup shows.
 *
 * Pulled out of the popup deliberately: this is the arithmetic that decides
 * what a user believes they own, and it is worth testing against real wallet
 * data rather than through the DOM.
 *
 * The subtlety that broke it twice:
 *   - a chain has one balance row PER DERIVATION INDEX, because the web wallet
 *     issues a fresh receiving address each time it is asked. Funds accumulate
 *     across indexes and must be summed, not overwritten.
 *   - several assets share one address (ETH, BNB and every ERC-20 on the same
 *     EVM key), so grouping by address merges unrelated assets. Group by ASSET.
 */

export interface AddressBalanceInput {
  chain: string;
  address: string;
  balance: string;
  /** True when this extension derived the address from the seed itself. */
  derived?: boolean;
}

export interface DerivedAddressInput {
  chain: string;
  address: string;
}

export interface AssetRow {
  /** Chain or token code, e.g. ETH or USDC_ETH. */
  asset: string;
  /** Address to receive on — the locally derived one when we have it. */
  address: string;
  /** Summed across every derivation index, as a decimal string. */
  balance: string;
  /** False for assets known only from the portal's record of this wallet. */
  derived: boolean;
}

/**
 * One row per asset, summed across addresses, funded assets first.
 *
 * `derived` addresses seed the list so an empty wallet still shows where to
 * receive; portal balances then fill in the amounts and add assets this
 * extension cannot derive (DOGE, XRP, ADA, LN).
 */
export function aggregateAssets(
  derived: DerivedAddressInput[],
  balances: AddressBalanceInput[],
): AssetRow[] {
  const byAsset = new Map<string, AssetRow>();

  for (const entry of derived) {
    byAsset.set(entry.chain, {
      asset: entry.chain,
      address: entry.address,
      balance: '0',
      derived: true,
    });
  }

  for (const b of balances) {
    const existing = byAsset.get(b.chain);
    const amount = Number(b.balance);
    const running = Number(existing?.balance ?? '0');
    byAsset.set(b.chain, {
      asset: b.chain,
      address: existing?.address ?? b.address,
      // A malformed row must not wipe out a good one, so treat NaN as zero.
      balance: String(running + (Number.isFinite(amount) ? amount : 0)),
      derived: existing?.derived ?? b.derived ?? false,
    });
  }

  return [...byAsset.values()].sort((a, b) => {
    const funded = (row: AssetRow) => Number(row.balance) > 0;
    if (funded(a) !== funded(b)) return funded(a) ? -1 : 1;
    return a.asset.localeCompare(b.asset);
  });
}

export function isFunded(row: AssetRow): boolean {
  return Number(row.balance) > 0;
}

/**
 * The symbol to price an asset with.
 *
 * Lightning has no market of its own — a sat is a bitcoin sat — and the rates
 * endpoint has no LN pair, so an LN balance came back unpriced and was silently
 * left out of the wallet total. The portal prices it as BTC (CHAIN_TO_RATE_SYMBOL
 * in balances/total-usd); do the same so the two agree.
 */
export function rateSymbolFor(asset: string): string {
  return asset === 'LN' ? 'BTC' : asset;
}

export interface WalletTotal {
  total: number;
  /** Assets that had a balance and a usable rate. */
  priced: number;
  /** Assets that had a balance but no rate — the total excludes them. */
  unpriced: number;
}

/**
 * Total value of the funded assets. Anything without a rate is counted as
 * `unpriced` rather than as zero, so the caller can say the number is partial
 * instead of presenting an understated total as complete.
 */
export function totalFiat(rows: AssetRow[], rateFor: (asset: string) => number | null): WalletTotal {
  let total = 0;
  let priced = 0;
  let unpriced = 0;

  for (const row of rows) {
    if (!isFunded(row)) continue;
    const rate = rateFor(row.asset);
    if (rate === null || !Number.isFinite(rate) || rate <= 0) {
      unpriced++;
      continue;
    }
    total += Number(row.balance) * rate;
    priced++;
  }

  return { total, priced, unpriced };
}
