'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { requireAuth } from '@/lib/auth/client';

/**
 * The /banking console: link a bank account, move money, watch it settle.
 *
 * Direction is always from CoinPay's point of view, and the page says so in
 * words rather than in the word "debit": "Pull from my bank" and "Pay out to
 * my bank" cannot be read two ways.
 *
 * The idempotency key for a transfer is minted when the form is opened, not
 * when it is submitted, so a double click or a retried request after a
 * timeout replays the same key and the server returns the same transfer.
 */

type Rail = {
  enabled: boolean;
  provider: { id: string; label: string; currencies: string[] } | null;
  holdDays: number;
};

type Account = {
  id: string;
  businessId: string | null;
  provider: string;
  holderName: string;
  accountType: 'checking' | 'savings';
  routingNumber: string;
  accountLast4: string;
  createdAt: string;
};

type Transfer = {
  id: string;
  bankCounterpartyId: string | null;
  direction: 'debit' | 'credit';
  amountMinor: number;
  currency: string;
  status: 'initiated' | 'pending' | 'settled' | 'completed' | 'returned' | 'failed' | 'canceled';
  providerStatus: string | null;
  returnCode: string | null;
  description: string | null;
  createdAt: string;
  settledAt: string | null;
  holdUntil: string | null;
  completedAt: string | null;
  returnedAt: string | null;
  error: string | null;
};

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_STYLE: Record<Transfer['status'], string> = {
  initiated: 'bg-slate-700 text-gray-200',
  pending: 'bg-amber-500/20 text-amber-300',
  settled: 'bg-sky-500/20 text-sky-300',
  completed: 'bg-emerald-500/20 text-emerald-300',
  returned: 'bg-red-500/20 text-red-300',
  failed: 'bg-red-500/20 text-red-300',
  canceled: 'bg-slate-700 text-gray-400',
};

const STATUS_HELP: Record<Transfer['status'], string> = {
  initiated: 'Accepted, not yet in the ACH network.',
  pending: 'In the network. The money has not moved yet.',
  settled: 'The money has moved. Still inside the return window.',
  completed: 'Settled and past the hold. A late return is still possible for sixty days.',
  returned: 'The bank sent it back.',
  failed: 'Never entered the network.',
  canceled: 'Withdrawn before submission.',
};

export default function BankingContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [rail, setRail] = useState<Rail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const [holderName, setHolderName] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking');
  const [linking, setLinking] = useState(false);

  const [accountId, setAccountId] = useState('');
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!requireAuth(router)) return;
    setError(null);
    try {
      const [railRes, accountsRes, transfersRes] = await Promise.all([
        fetch('/api/banking', { headers: authHeaders() }),
        fetch('/api/banking/accounts', { headers: authHeaders() }),
        fetch('/api/banking/transfers', { headers: authHeaders() }),
      ]);
      if (railRes.status === 401 || railRes.status === 403) {
        setError('Your session has expired. Please log in again.');
        return;
      }
      if (!railRes.ok) {
        setError('Failed to load bank transfers.');
        return;
      }
      setRail(await railRes.json());
      if (accountsRes.ok) setAccounts((await accountsRes.json()).accounts ?? []);
      if (transfersRes.ok) setTransfers((await transfersRes.json()).transfers ?? []);
    } catch {
      setError('Failed to load bank transfers.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  async function readError(res: Response, fallback: string): Promise<string> {
    try {
      const body = await res.json();
      return typeof body?.error === 'string' ? body.error : fallback;
    } catch {
      return fallback;
    }
  }

  async function linkAccount(event: React.FormEvent) {
    event.preventDefault();
    setLinking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/banking/accounts', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ holderName, routingNumber, accountNumber, accountType }),
      });
      if (!res.ok) {
        setError(await readError(res, 'Could not link the bank account.'));
        return;
      }
      const { account } = (await res.json()) as { account: Account };
      setAccounts((prev) => [account, ...prev]);
      setAccountId(account.id);
      setHolderName('');
      setRoutingNumber('');
      setAccountNumber('');
      setNotice(`Linked ${account.holderName}'s ${account.accountType} account ending ${account.accountLast4}.`);
    } catch {
      setError('Could not link the bank account.');
    } finally {
      setLinking(false);
    }
  }

  async function removeAccount(id: string) {
    if (!window.confirm('Stop using this bank account? Past transfers keep their history.')) return;
    const res = await fetch(`/api/banking/accounts/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) {
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      if (accountId === id) setAccountId('');
    } else {
      setError(await readError(res, 'Could not remove the bank account.'));
    }
  }

  async function sendTransfer(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    const amountMinor = Math.round(dollars * 100);
    setSending(true);
    try {
      const res = await fetch('/api/banking/transfers', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }),
        body: JSON.stringify({ accountId, direction, amountMinor, currency: 'USD', description: description || undefined }),
      });
      if (!res.ok) {
        setError(await readError(res, 'Could not start the transfer.'));
        return;
      }
      const { transfer } = (await res.json()) as { transfer: Transfer };
      setTransfers((prev) => [transfer, ...prev.filter((t) => t.id !== transfer.id)]);
      setAmount('');
      setDescription('');
      // Only after a transfer is on record does the next one get a fresh key.
      setIdempotencyKey(newKey());
      setNotice(
        transfer.status === 'failed'
          ? `The originator rejected the transfer: ${transfer.error ?? 'no reason given'}.`
          : `${direction === 'debit' ? 'Pulling' : 'Paying out'} ${money(amountMinor, 'USD')}. It will show as settled when the money moves.`,
      );
    } catch {
      setError('Could not start the transfer.');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="container mx-auto px-4 py-16 text-center text-gray-400">Loading bank transfers…</div>;
  }

  if (error && !rail) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-red-400 mb-2">{error}</p>
        <Link href="/dashboard" className="text-purple-400 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const enabled = rail?.enabled ?? false;
  const accountFor = (id: string | null) => accounts.find((a) => a.id === id);

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-3xl font-bold text-white">Bank transfers</h1>
        <p className="text-gray-400 mt-1">
          Move US dollars between a bank account and CoinPay over ACH.
          {enabled && rail?.provider ? ` Originated by ${rail.provider.label}.` : ''}
        </p>
      </div>

      {!enabled && (
        <div className="mt-6 mb-8 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Bank transfers are not enabled on this deployment yet. No originator is configured, so accounts cannot be
          linked and no money can move.
        </div>
      )}

      {notice && (
        <div className="mt-6 mb-6 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-6 mb-6 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid gap-8 md:grid-cols-2 mt-6">
        <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
          <h2 className="text-lg font-semibold text-white mb-2">Bank accounts</h2>
          <p className="text-sm text-gray-400 mb-4">
            The account number goes to the originator and is not stored here. Only the last four digits are kept.
          </p>

          {accounts.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">No bank accounts linked.</p>
          ) : (
            <ul className="mb-4 divide-y divide-slate-800">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="text-white">
                      {a.holderName} · {a.accountType} ····{a.accountLast4}
                    </div>
                    <div className="text-xs text-gray-500">Routing {a.routingNumber}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAccount(a.id)}
                    className="text-xs text-gray-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={linkAccount} className="flex flex-col gap-3">
            <input
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="Name on the account"
              required
              disabled={!enabled}
              className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
            <div className="flex gap-3">
              <input
                value={routingNumber}
                onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                placeholder="Routing number (9 digits)"
                inputMode="numeric"
                required
                disabled={!enabled}
                className="flex-1 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-gray-600"
              />
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as 'checking' | 'savings')}
                disabled={!enabled}
                className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </div>
            <input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 17))}
              placeholder="Account number"
              inputMode="numeric"
              autoComplete="off"
              required
              disabled={!enabled}
              className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
            <button
              type="submit"
              disabled={!enabled || linking}
              className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {linking ? 'Linking…' : 'Link bank account'}
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
          <h2 className="text-lg font-semibold text-white mb-2">New transfer</h2>
          <p className="text-sm text-gray-400 mb-4">
            A transfer shows as settled when the money moves and as completed {rail?.holdDays ?? 5} days later. A bank
            can still return it for up to sixty days.
          </p>

          <form onSubmit={sendTransfer} className="flex flex-col gap-3">
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              disabled={!enabled || accounts.length === 0}
              className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {accounts.length === 0 && <option value="">Link a bank account first</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.holderName} · {a.accountType} ····{a.accountLast4}
                </option>
              ))}
            </select>
            <div className="flex gap-3">
              <label className="flex-1 flex items-center gap-2 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-gray-200">
                <input type="radio" checked={direction === 'debit'} onChange={() => setDirection('debit')} disabled={!enabled} />
                Pull from my bank
              </label>
              <label className="flex-1 flex items-center gap-2 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-gray-200">
                <input type="radio" checked={direction === 'credit'} onChange={() => setDirection('credit')} disabled={!enabled} />
                Pay out to my bank
              </label>
            </div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount in USD"
              inputMode="decimal"
              required
              disabled={!enabled}
              className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 22))}
              placeholder="Statement text (up to 22 characters)"
              disabled={!enabled}
              className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
            <button
              type="submit"
              disabled={!enabled || sending || !accountId}
              className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {sending ? 'Sending…' : direction === 'debit' ? 'Pull funds' : 'Pay out'}
            </button>
          </form>
        </section>
      </div>

      <section className="mt-8 rounded-lg border border-slate-700 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Transfers</h2>
          <button type="button" onClick={() => void load()} className="text-sm text-purple-400 hover:underline">
            Refresh
          </button>
        </div>
        {transfers.length === 0 ? (
          <p className="text-sm text-gray-500">No transfers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Direction</th>
                  <th className="py-2 pr-4">Account</th>
                  <th className="py-2 pr-4 text-right">Amount</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {transfers.map((t) => {
                  const account = accountFor(t.bankCounterpartyId);
                  return (
                    <tr key={t.id} className="text-gray-200">
                      <td className="py-2 pr-4 whitespace-nowrap">{when(t.createdAt)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{t.direction === 'debit' ? 'From bank' : 'To bank'}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {account ? `····${account.accountLast4}` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">{money(t.amountMinor, t.currency)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <span
                          title={STATUS_HELP[t.status]}
                          className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-gray-400">
                        {t.status === 'returned' && `Returned ${when(t.returnedAt)}${t.returnCode ? ` (${t.returnCode})` : ''}`}
                        {t.status === 'settled' && t.holdUntil && `Settled ${when(t.settledAt)} · completes ${when(t.holdUntil)}`}
                        {t.status === 'completed' && `Settled ${when(t.settledAt)}`}
                        {t.status === 'failed' && (t.error ?? 'Rejected by the originator')}
                        {(t.status === 'initiated' || t.status === 'pending') && (t.description ?? '')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
