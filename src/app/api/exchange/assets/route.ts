/**
 * GET /api/exchange/assets — assets the exchange can route, and by whom.
 */

import { guardEnabled, json } from '@/lib/exchange/http';
import { listAssets } from '@/lib/exchange/assets';
import { getAdapters } from '@/lib/exchange/router';
import { isProviderEnabled } from '@/lib/exchange/policy';

export async function GET() {
  const off = guardEnabled();
  if (off) return off;

  const adapters = getAdapters().filter((a) => a.isConfigured() && isProviderEnabled(a.id));
  const assets = listAssets().map((a) => ({
    symbol: a.symbol,
    name: a.name,
    chain: a.chain,
    decimals: a.decimals,
    providers: adapters
      .filter((p) => listAssets().some((b) => b.symbol !== a.symbol && p.supports(a.symbol, b.symbol)))
      .map((p) => p.id),
  }));
  return json({
    rails: { crypto_crypto: true, fiat_crypto: false, crypto_fiat: false },
    assets: assets.filter((a) => a.providers.length > 0),
  });
}
