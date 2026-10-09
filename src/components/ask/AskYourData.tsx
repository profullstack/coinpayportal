'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

type Scope = 'me' | 'org' | 'platform';

type Status =
  | { state: 'loading' }
  | { state: 'allowed'; remaining: number; limit: number }
  | { state: 'blocked'; code: string; error: string; upgradeUrl?: string };

const PLACEHOLDER: Record<Scope, string> = {
  me: 'e.g. How much did my businesses take in last month, and what did I spend on software?',
  org: 'e.g. Which business in this organization had the most settled payments this quarter?',
  platform: 'e.g. What were my biggest expenses in September, and how does revenue compare?',
};

/**
 * "Ask Your Data": type a question about your businesses, payments, invoices and
 * finances, get an answer. Free for platform admins, Professional plan otherwise;
 * the server decides (GET /api/ask) and this shows the upgrade prompt when it says no.
 */
export function AskYourData({
  scope = 'me',
  organizationId,
  title = 'Ask Your Data',
  placeholder,
}: {
  scope?: Scope;
  organizationId?: string;
  title?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asked, setAsked] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const qs = new URLSearchParams({ scope, ...(organizationId ? { organizationId } : {}) }).toString();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await authFetch(`/api/ask?${qs}`, {}, router);
        if (!result || cancelled) return;
        const { data } = result;
        if (data?.allowed) setStatus({ state: 'allowed', remaining: data.remaining, limit: data.limit });
        else setStatus({ state: 'blocked', code: data?.code ?? 'error', error: data?.error ?? 'Unavailable', upgradeUrl: data?.upgradeUrl });
      } catch {
        // Offline or the endpoint is unreachable: hide the box rather than break the page.
        if (!cancelled) setStatus({ state: 'blocked', code: 'disabled', error: '' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qs, router]);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    setAnswer('');
    setAsked(q);
    try {
      const result = await authFetch(
        '/api/ask',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, scope, ...(organizationId ? { organizationId } : {}) }),
        },
        router,
      );
      if (!result) return;
      const { response, data } = result;
      if (!response.ok) {
        if (data?.code === 'upgrade_required') {
          setStatus({ state: 'blocked', code: data.code, error: data.error, upgradeUrl: data.upgradeUrl });
        }
        setError(data?.error || 'Could not answer that right now');
        return;
      }
      setAnswer(data.answer);
      setQuestion('');
      if (status.state === 'allowed') setStatus({ ...status, remaining: data.remaining ?? status.remaining - 1 });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (status.state === 'blocked' && status.code === 'disabled') return null;

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
        {status.state === 'allowed' && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {status.remaining} of {status.limit} questions left today
          </span>
        )}
      </div>

      {status.state === 'blocked' ? (
        <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-4 text-sm text-gray-700 dark:text-gray-200">
          <p className="mb-2">
            Ask plain-English questions about your businesses, payments, invoices and finances.{' '}
            {status.error}
          </p>
          {status.upgradeUrl && (
            <Link
              href={status.upgradeUrl}
              className="inline-block bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-lg"
            >
              Upgrade to Professional
            </Link>
          )}
        </div>
      ) : (
        <form onSubmit={ask} className="space-y-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(e as unknown as React.FormEvent);
            }}
            rows={3}
            maxLength={2000}
            disabled={status.state === 'loading' || busy}
            placeholder={placeholder ?? PLACEHOLDER[scope]}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-none resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Answers come only from data you can already see. Last 90 days.
            </span>
            <button
              type="submit"
              disabled={busy || !question.trim() || status.state !== 'allowed'}
              className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {busy ? 'Thinking…' : 'Ask'}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {answer && (
        <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{asked}</p>
          <div className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">{answer}</div>
        </div>
      )}
    </section>
  );
}
