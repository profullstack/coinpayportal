import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAddress, getChain, NotFoundError } from '@/lib/explorer';
import { Field, SearchForm, truncate, TxRow } from '@/components/explorer/ui';
import { SITE_URL } from '@/lib/blog';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ chain: string; address: string }> };

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { chain, address } = await params;
  const c = getChain(chain);
  if (!c) return { title: 'Not found — CoinPay' };
  return {
    title: `${c.name} address ${truncate(address, 10, 6)} — CoinPay Explorer`,
    description: `Balance and transaction history for ${c.name} address ${address}.`,
    alternates: { canonical: `${SITE_URL}/explorer/${c.id}/address/${address}` },
  };
}

export default async function AddressPage({ params }: RouteParams) {
  const { chain, address } = await params;
  const c = getChain(chain);
  if (!c) notFound();

  let info;
  try {
    info = await getAddress(c.id, address);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    return (
      <div className="container mx-auto max-w-4xl px-4 py-16">
        <SearchForm />
        <div className="mt-8 rounded-lg border border-red-500/40 bg-red-900/20 p-6">
          <h1 className="text-xl font-semibold text-red-300">{c.name} is not answering</h1>
          <p className="mt-2 text-sm text-red-200/80">
            The upstream source for {c.name} could not be reached, so this balance could not be
            loaded. Nothing here means the address is empty — only that we could not ask.
          </p>
          <p className="mt-3 font-mono text-xs break-all text-red-200/60">{address}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-16">
      <SearchForm />

      <div className="mt-8 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white">Address</h1>
        <span className="text-sm text-gray-400">{c.name}</span>
      </div>

      <dl className="rounded-lg border border-gray-700 bg-gray-800/50 px-6">
        <Field label="Address">
          <span className="font-mono">{info.address}</span>
        </Field>
        <Field label="Balance">
          <span className="text-lg font-semibold">
            {info.balance} {c.symbol}
          </span>
        </Field>
        <Field label="Transactions">
          {info.txCount !== null ? info.txCount.toLocaleString() : '—'}
        </Field>
      </dl>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-white">Recent transactions</h2>

      {info.historyUnavailable ? (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-900/20 p-4 text-sm text-yellow-200/80">
          {info.historyUnavailable}
        </div>
      ) : info.transactions.length === 0 ? (
        <p className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-sm text-gray-400">
          No transactions found for this address.
        </p>
      ) : (
        <ul className="rounded-lg border border-gray-700 bg-gray-800/50 px-6">
          {info.transactions.map((tx) => (
            <TxRow key={tx.hash} tx={tx} symbol={c.symbol} />
          ))}
        </ul>
      )}
    </div>
  );
}
