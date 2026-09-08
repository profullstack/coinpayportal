import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatUnitPrice, getChain, getChainOverview } from '@/lib/explorer';
import { formatTime, SearchForm, truncate } from '@/components/explorer/ui';
import { SITE_URL } from '@/lib/blog';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ chain: string }> };

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { chain } = await params;
  const c = getChain(chain);
  if (!c) return { title: 'Not found — CoinPay' };
  return {
    title: `${c.name} explorer — CoinPay`,
    description: `Latest ${c.name} blocks, recent transactions and the current ${c.symbol} price.`,
    alternates: { canonical: `${SITE_URL}/explorer/${c.id}` },
  };
}

export default async function ChainPage({ params }: RouteParams) {
  const { chain } = await params;
  const c = getChain(chain);
  if (!c) notFound();

  const overview = await getChainOverview(c.id, { withBlock: true });
  const block = overview.latestBlock;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-16">
      <SearchForm />

      <div className="mt-8 mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="text-3xl font-bold text-white">{c.name}</h1>
        <span className="text-sm text-gray-400">{c.symbol}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Price</div>
          <div className="mt-1 text-2xl font-semibold text-white">
            {formatUnitPrice(overview.usdRate)}
          </div>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Block height</div>
          <div className="mt-1 text-2xl font-semibold text-white">
            {overview.tipHeight !== null ? overview.tipHeight.toLocaleString() : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Latest block</div>
          <div className="mt-1 text-sm text-white">
            {block ? formatTime(block.timestamp) : '—'}
          </div>
        </div>
      </div>

      {overview.tipHeight === null && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-900/20 p-4 text-sm text-red-200/80">
          {c.name} is not answering right now, so height and recent activity are unavailable. The
          price above comes from a separate source.
        </div>
      )}

      {block && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold text-white">
            Latest block{' '}
            <Link
              href={`/explorer/${c.id}/block/${block.height}`}
              className="text-blue-400 hover:text-blue-300"
            >
              #{block.height.toLocaleString()}
            </Link>
          </h2>
          <p className="mb-4 text-sm text-gray-400">
            {block.txCount !== null ? `${block.txCount.toLocaleString()} transactions` : ''}
            {block.timestamp ? ` · ${formatTime(block.timestamp)}` : ''}
          </p>

          {block.txHashes && block.txHashes.length > 0 ? (
            <>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Recent transactions
              </h3>
              <ul className="rounded-lg border border-gray-700 bg-gray-800/50 px-6">
                {block.txHashes.map((hash) => (
                  <li key={hash} className="border-b border-gray-800 py-3 last:border-b-0">
                    <Link
                      href={`/explorer/${c.id}/tx/${hash}`}
                      className="font-mono text-sm text-blue-400 hover:text-blue-300"
                    >
                      {truncate(hash, 24, 12)}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-500">
                Showing the first {block.txHashes.length} transactions of this block. Open a
                transaction for its amounts and USD value.
              </p>
            </>
          ) : block.txCount === 0 ? (
            // Cardano and Dogecoin produce blocks every few seconds or minutes
            // and empty ones are entirely normal, so this must not read as a
            // failure to load anything.
            <p className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-sm text-gray-400">
              This block is empty — no transactions were included. That is normal on{' '}
              {c.name}; try an earlier block.
            </p>
          ) : (
            <p className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-sm text-gray-400">
              This source does not list the transactions in a block. Open the block for its
              details.
            </p>
          )}
        </>
      )}
    </div>
  );
}
