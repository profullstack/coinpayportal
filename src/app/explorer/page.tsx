import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  classifySearch,
  searchHref,
  EXPLORER_CHAINS,
  formatUnitPrice,
  getChain,
  getChainOverview,
} from '@/lib/explorer';
import { SearchForm } from '@/components/explorer/ui';
import { SITE_URL } from '@/lib/blog';

/**
 * Live height and price for every network.
 *
 * Each chain is fetched independently and allowed to fail on its own, so one
 * unreachable node leaves a single dash rather than blanking the grid. Ten
 * chains in parallel is ten upstream calls, which is why this only runs on
 * the unsearched landing page.
 */
async function NetworkGrid() {
  const overviews = await Promise.all(
    EXPLORER_CHAINS.map((chain) => getChainOverview(chain.id))
  );

  return (
    <div className="mt-10">
      <h2 className="mb-4 text-lg font-semibold text-white">Networks</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {overviews.map((o) => {
          const chain = getChain(o.chainId);
          if (!chain) return null;
          return (
            <li key={o.chainId}>
              <Link
                href={`/explorer/${o.chainId}`}
                className="block rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3 hover:border-blue-500"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-white">{chain.name}</span>
                  <span className="text-sm text-gray-400">{chain.symbol}</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between text-sm">
                  <span className="text-white">{formatUnitPrice(o.usdRate)}</span>
                  <span className="text-gray-500">
                    {o.tipHeight !== null ? `#${o.tipHeight.toLocaleString()}` : 'unreachable'}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        Prices in USD. Block heights are read live from each network.
      </p>
    </div>
  );
}

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Block Explorer — CoinPay',
  description:
    'Look up transactions, addresses and blocks across Bitcoin, Ethereum, Solana, XRP, Cardano and every other network CoinPay settles on.',
  alternates: { canonical: `${SITE_URL}/explorer` },
};

type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function ExplorerPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const candidates = query ? classifySearch(query) : [];

  // One unambiguous reading goes straight there. Anything else is presented,
  // because a 64-character hash is a valid transaction id on six of these
  // chains and quietly picking one would show a false "not found".
  if (candidates.length === 1) redirect(searchHref(candidates[0]));

  return (
    <div className="container mx-auto max-w-4xl px-4 py-16">
      <h1 className="mb-2 text-4xl font-bold text-white">Block Explorer</h1>
      <p className="mb-8 text-gray-400">
        Every network CoinPay settles on, in one place. No account, no API key.
      </p>

      <SearchForm defaultValue={query} />

      {query && candidates.length === 0 && (
        <div className="mt-8 rounded-lg border border-yellow-500/40 bg-yellow-900/20 p-6">
          <h2 className="font-semibold text-yellow-300">Not recognised</h2>
          <p className="mt-2 text-sm text-yellow-200/80">
            “{query}” does not look like an address, transaction hash or block height on any
            supported network.
          </p>
        </div>
      )}

      {candidates.length > 1 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-white">
            That could be {candidates.length} things
          </h2>
          <p className="mb-4 text-sm text-gray-400">
            This format is shared across networks. Pick the one you meant.
          </p>
          <ul className="space-y-2">
            {candidates.map((c) => {
              const chain = getChain(c.chainId);
              return (
                <li key={`${c.chainId}-${c.kind}`}>
                  <Link
                    href={searchHref(c)}
                    className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3 hover:border-blue-500"
                  >
                    <span className="text-white">{chain?.name ?? c.chainId}</span>
                    <span className="text-sm text-gray-400">{c.kind}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!query && <NetworkGrid />}
    </div>
  );
}
