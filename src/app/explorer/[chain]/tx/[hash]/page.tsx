import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getChain, getTransaction, NotFoundError } from '@/lib/explorer';
import { Field, formatTime, SearchForm, StatusPill, truncate } from '@/components/explorer/ui';
import { SITE_URL } from '@/lib/blog';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ chain: string; hash: string }> };

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { chain, hash } = await params;
  const c = getChain(chain);
  if (!c) return { title: 'Not found — CoinPay' };
  return {
    title: `${c.name} transaction ${truncate(hash, 10, 6)} — CoinPay Explorer`,
    description: `Details for ${c.name} transaction ${hash}.`,
    alternates: { canonical: `${SITE_URL}/explorer/${c.id}/tx/${hash}` },
  };
}

export default async function TransactionPage({ params }: RouteParams) {
  const { chain, hash } = await params;
  const c = getChain(chain);
  if (!c) notFound();

  let tx;
  try {
    tx = await getTransaction(c.id, hash);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    return (
      <div className="container mx-auto max-w-4xl px-4 py-16">
        <SearchForm />
        <div className="mt-8 rounded-lg border border-red-500/40 bg-red-900/20 p-6">
          <h1 className="text-xl font-semibold text-red-300">{c.name} is not answering</h1>
          <p className="mt-2 text-sm text-red-200/80">
            The upstream source for {c.name} could not be reached, so this transaction could not
            be loaded. It may still exist — try again shortly.
          </p>
          <p className="mt-3 font-mono text-xs break-all text-red-200/60">{hash}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-16">
      <SearchForm />

      <div className="mt-8 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white">Transaction</h1>
        <StatusPill status={tx.status} />
        <span className="text-sm text-gray-400">{c.name}</span>
      </div>

      <dl className="rounded-lg border border-gray-700 bg-gray-800/50 px-6">
        <Field label="Hash">
          <span className="font-mono">{tx.hash}</span>
        </Field>
        <Field label="Amount">
          {tx.amount || '—'} {tx.amount ? c.symbol : ''}
        </Field>
        <Field label="Fee">{tx.fee ? `${tx.fee} ${c.symbol}` : '—'}</Field>
        <Field label="Block">
          {tx.blockHeight !== null ? (
            <Link
              href={`/explorer/${c.id}/block/${tx.blockHeight}`}
              className="text-blue-400 hover:text-blue-300"
            >
              {tx.blockHeight.toLocaleString()}
            </Link>
          ) : (
            'Unconfirmed'
          )}
        </Field>
        <Field label="Confirmations">
          {tx.confirmations !== null ? tx.confirmations.toLocaleString() : '—'}
        </Field>
        <Field label="Time">{formatTime(tx.timestamp)}</Field>
      </dl>

      {tx.transfers.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold text-white">
            Transfers ({tx.transfers.length})
          </h2>
          <ul className="rounded-lg border border-gray-700 bg-gray-800/50 px-6">
            {tx.transfers.map((t, i) => (
              <li key={i} className="border-b border-gray-800 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {t.from ? (
                    <Link
                      href={`/explorer/${c.id}/address/${t.from}`}
                      className="font-mono text-blue-400 hover:text-blue-300"
                    >
                      {truncate(t.from)}
                    </Link>
                  ) : (
                    <span className="text-gray-500">newly minted</span>
                  )}
                  <span className="text-gray-500">→</span>
                  {t.to ? (
                    <Link
                      href={`/explorer/${c.id}/address/${t.to}`}
                      className="font-mono text-blue-400 hover:text-blue-300"
                    >
                      {truncate(t.to)}
                    </Link>
                  ) : (
                    <span className="text-gray-500">unspendable</span>
                  )}
                  <span className="ml-auto text-white">
                    {t.amount} {c.symbol}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
