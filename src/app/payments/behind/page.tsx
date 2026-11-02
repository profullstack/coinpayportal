'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';
import type { BehindAction, BehindCustomer, BehindReport } from '@/lib/payments/behind';
import { draftEmail } from '@/lib/payments/behind-email';

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};
const owedText = (c: BehindCustomer) => c.owed.map((o) => money(o.amount, o.currency)).join(' + ');
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const ACCENT: Record<BehindAction, string> = {
  unreachable: 'border-red-500/60',
  chase: 'border-red-500/60',
  remind: 'border-yellow-500/60',
  retry: 'border-green-500/60',
  new_card: 'border-yellow-500/60',
  unfinished: 'border-blue-500/60',
  call_bank: 'border-yellow-500/60',
  do_not_chase: 'border-gray-500/60',
};

export default function BehindPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Array<{ id: string; name: string }>>([]);
  const [businessId, setBusinessId] = useState('');
  const [report, setReport] = useState<BehindReport | null>(null);
  const [error, setError] = useState('');
  const [resent, setResent] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/businesses', {}, router);
      const list = result?.data?.businesses ?? (Array.isArray(result?.data) ? result?.data : []);
      setBusinesses(list);
    })();
  }, [router]);

  useEffect(() => {
    (async () => {
      const qs = businessId ? `?business_id=${encodeURIComponent(businessId)}` : '';
      const result = await authFetch(`/api/payments/behind${qs}`, {}, router);
      if (!result) return;
      if (result.data?.success) {
        setError('');
        setReport(result.data as BehindReport);
      } else {
        setError(result.data?.error || 'Could not load payments');
      }
    })();
  }, [businessId, router]);

  async function resend(invoiceId: string) {
    setResent((s) => ({ ...s, [invoiceId]: 'Sending…' }));
    const result = await authFetch(`/api/invoices/${invoiceId}/resend-email`, { method: 'POST' }, router);
    setResent((s) => ({ ...s, [invoiceId]: result?.data?.success ? 'Sent' : result?.data?.error || 'Failed' }));
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Who&apos;s behind</h1>
          <p className="mt-2 text-gray-400">
            Overdue invoices and declined card payments, by customer, grouped by what to do next.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {businesses.length > 1 && (
            <select
              aria-label="Business"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            >
              <option value="">All businesses</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <Link href="/invoices/aging" className="text-sm text-purple-400 hover:text-purple-300">
            Aging report →
          </Link>
        </div>

        {error ? (
          <p className="text-red-400">{error}</p>
        ) : !report ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400" />
          </div>
        ) : (
          <>
            <p className="text-lg text-white bg-gray-800/50 rounded-2xl border border-gray-700 p-5" data-testid="behind-summary">
              {report.summary}
            </p>

            {report.groups.map((g) => (
              <section key={g.action} className="space-y-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">
                    {g.title} <span className="text-gray-500 text-base">· {g.customers.length}</span>
                  </h2>
                  <p className="text-sm text-gray-400">{g.todo}</p>
                </div>

                {g.customers.map((c) => {
                  const mail = draftEmail(c);
                  return (
                    <article
                      key={c.key}
                      className={`bg-gray-800/60 rounded-xl border-l-4 ${ACCENT[c.action]} border border-gray-700 p-5`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <h3 className="text-white font-semibold uppercase tracking-wide">{c.name}</h3>
                          <p className="text-xs text-gray-500">
                            {[c.email, businesses.length > 1 ? c.business_name : null].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="text-2xl font-bold text-white">{owedText(c)}</div>
                      </div>

                      <ul className="mt-3 divide-y divide-gray-700/60">
                        {c.items.map((i) => (
                          <li key={`${i.kind}-${i.id}`} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                            <div>
                              <Link href={i.href} className="text-gray-200 hover:text-white">
                                {i.title}
                              </Link>
                              <span className="text-gray-500"> · {money(i.amount, i.currency)}</span>
                              {i.kind === 'invoice' && <span className="text-gray-500"> · due {day(i.date)}</span>}
                              <div className="text-gray-400">{i.detail}</div>
                            </div>
                            {i.kind === 'invoice' && (
                              <button
                                onClick={() => resend(i.id)}
                                disabled={resent[i.id] === 'Sending…' || resent[i.id] === 'Sent'}
                                className="px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-100 text-xs disabled:opacity-60"
                              >
                                {resent[i.id] || 'Resend invoice'}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-gray-400">{c.history.line}</p>
                        {mail && (
                          <a
                            href={mail}
                            className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm"
                          >
                            Email {c.name.split(/\s+/)[0]}
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
