import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBlock, getChain, NotFoundError } from '@/lib/explorer';
import { Field, formatTime, SearchForm, truncate } from '@/components/explorer/ui';
import { SITE_URL } from '@/lib/blog';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ chain: string; ref: string }> };

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { chain, ref } = await params;
  const c = getChain(chain);
  if (!c) return { title: 'Not found — CoinPay' };
  return {
    title: `${c.name} block ${ref} — CoinPay Explorer`,
    description: `Details for ${c.name} block ${ref}.`,
    alternates: { canonical: `${SITE_URL}/explorer/${c.id}/block/${ref}` },
  };
}

export default async function BlockPage({ params }: RouteParams) {
  const { chain, ref } = await params;
  const c = getChain(chain);
  if (!c) notFound();

  let block;
  try {
    block = await getBlock(c.id, ref);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    return (
      <div className="container mx-auto max-w-4xl px-4 py-16">
        <SearchForm />
        <div className="mt-8 rounded-lg border border-red-500/40 bg-red-900/20 p-6">
          <h1 className="text-xl font-semibold text-red-300">{c.name} is not answering</h1>
          <p className="mt-2 text-sm text-red-200/80">
            The upstream source for {c.name} could not be reached, so block {ref} could not be
            loaded.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-16">
      <SearchForm />

      <div className="mt-8 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white">
          Block {block.height.toLocaleString()}
        </h1>
        <Link href={`/explorer/${c.id}`} className="text-sm text-blue-400 hover:text-blue-300">
          {c.name}
        </Link>
      </div>

      <dl className="rounded-lg border border-gray-700 bg-gray-800/50 px-6">
        <Field label="Height">{block.height.toLocaleString()}</Field>
        <Field label="Hash">
          <span className="font-mono">{block.hash || '—'}</span>
        </Field>
        <Field label="Time">{formatTime(block.timestamp)}</Field>
        <Field label="Transactions">
          {block.txCount !== null ? block.txCount.toLocaleString() : '—'}
        </Field>
      </dl>

      <div className="mt-6 flex gap-3">
        {block.height > 0 && (
          <Link
            href={`/explorer/${c.id}/block/${block.height - 1}`}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-blue-500"
          >
            ← Previous
          </Link>
        )}
        <Link
          href={`/explorer/${c.id}/block/${block.height + 1}`}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-blue-500"
        >
          Next →
        </Link>
      </div>

      {block.txHashes && block.txHashes.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold text-white">Transactions in this block</h2>
          <ul className="rounded-lg border border-gray-700 bg-gray-800/50 px-6">
            {block.txHashes.map((hash) => (
              <li key={hash} className="border-b border-gray-800 py-3 last:border-b-0">
                <Link
                  href={`/explorer/${c.id}/tx/${hash}`}
                  className="font-mono text-sm text-blue-400 hover:text-blue-300"
                >
                  {truncate(hash, 20, 12)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
