'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Revision {
  amount: string;
  currency: string;
  crypto_currency: string | null;
  proposed_by: 'merchant' | 'client';
  merchant_wallet_address: string | null;
}

interface Proposal {
  id: string;
  proposal_number: string;
  title: string;
  status: string;
  created_at: string;
  clients?: { name: string; email: string; company_name: string } | null;
  businesses?: { name: string } | null;
  current_revision?: Revision | null;
}

/** Colour per status so the negotiation state reads at a glance. */
const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  countered: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  withdrawn: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  expired: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

function formatAmount(amount: string | number, currency: string) {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export default function ProposalsPage() {
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/proposals', {}, router);
      if (!result) return;
      if (result.data.success) setProposals(result.data.proposals);
      else setError(result.data.error || 'Failed to load proposals');
      setLoading(false);
    })();
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Proposals</h1>
            <p className="mt-2 text-gray-400">
              Send a quote, negotiate it, and turn the agreed terms into an invoice.
            </p>
          </div>
          <Link
            href="/proposals/create"
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg whitespace-nowrap"
          >
            New Proposal
          </Link>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-400">Loading proposals...</p>
        ) : proposals.length === 0 ? (
          <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-12 text-center">
            <h2 className="text-lg font-medium text-white">No proposals yet</h2>
            <p className="mt-2 text-gray-400">
              A proposal lets you agree on price and terms before any invoice is raised.
            </p>
            <Link
              href="/proposals/create"
              className="mt-6 inline-block px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg"
            >
              Create your first proposal
            </Link>
          </div>
        ) : (
          <div className="bg-gray-800/50 border border-gray-700 rounded-2xl divide-y divide-gray-700">
            {proposals.map((p) => (
              <Link
                key={p.id}
                href={`/proposals/${p.id}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-gray-800 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white">{p.title}</span>
                    <span className="text-xs text-gray-500">{p.proposal_number}</span>
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${STATUS_STYLES[p.status] ?? STATUS_STYLES.draft}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-400 truncate">
                    {p.clients?.company_name || p.clients?.name || p.clients?.email || 'No client'}
                    {p.current_revision?.proposed_by === 'client' && (
                      <span className="ml-2 text-amber-400">· awaiting your response</span>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {p.current_revision && (
                    <>
                      <div className="text-white font-medium">
                        {formatAmount(p.current_revision.amount, p.current_revision.currency)}
                      </div>
                      {p.current_revision.crypto_currency && (
                        <div className="text-xs text-gray-500">
                          in {p.current_revision.crypto_currency}
                          {!p.current_revision.merchant_wallet_address && (
                            <span className="text-yellow-400"> · payee needed</span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
