import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { classifySearch, searchHref, EXPLORER_CHAINS, getChain } from '@/lib/explorer';
import { SearchForm } from '@/components/explorer/ui';
import { SITE_URL } from '@/lib/blog';

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

      {!query && (
        <div className="mt-10">
          <h2 className="mb-4 text-lg font-semibold text-white">Supported networks</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EXPLORER_CHAINS.map((chain) => (
              <li
                key={chain.id}
                className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3"
              >
                <span className="font-semibold text-white">{chain.name}</span>
                <span className="ml-2 text-sm text-gray-400">{chain.symbol}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
