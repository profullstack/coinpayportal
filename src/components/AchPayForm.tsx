'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Pay by bank: the buyer-facing ACH form, shared by the payment page and the
 * invoice page.
 *
 * It asks the route whether bank payment is offered here, shows the form
 * while it is, and once a debit is in flight shows its progress instead. The
 * form disappears after submission: a second submission would be a second
 * debit, and the server would refuse it, but a page that never offers it is
 * the safer shape.
 */

type PayinTransfer = {
  id: string;
  status: 'initiated' | 'pending' | 'settled' | 'completed' | 'returned' | 'failed' | 'canceled';
  amountMinor: number;
  currency: string;
  createdAt: string;
  settledAt: string | null;
  holdUntil: string | null;
  completedAt: string | null;
  returnedAt: string | null;
  returnCode: string | null;
  error: string | null;
};

type Status = {
  available: boolean;
  payable: boolean;
  holdDays: number;
  transfer: PayinTransfer | null;
};

/**
 * Ask the route whether bank payment is offered. `enabled` gates the request:
 * the pages turn it on only once they hold a payable payment or invoice, so a
 * confirmed or expired one never asks, and the page's own initial requests go
 * out first.
 */
export function useAchAvailability(endpoint: string, enabled = true) {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (!res.ok) {
        setStatus({ available: false, payable: false, holdDays: 5, transfer: null });
        return;
      }
      setStatus(await res.json());
    } catch {
      setStatus({ available: false, payable: false, holdDays: 5, transfer: null });
    }
  }, [endpoint]);
  useEffect(() => {
    if (enabled) void refresh();
  }, [refresh, enabled]);
  return { status, refresh };
}

const PROGRESS: Record<PayinTransfer['status'], string> = {
  initiated: 'Your bank payment has been submitted.',
  pending: 'Your bank payment is on its way through the ACH network.',
  settled: 'Your bank has sent the funds. The payment is being held briefly before it is confirmed.',
  completed: 'Your bank payment is confirmed.',
  returned: 'Your bank returned this payment.',
  failed: 'Your bank payment could not be started.',
  canceled: 'This bank payment was canceled.',
};

export default function AchPayForm({
  endpoint,
  amountLabel,
  onSubmitted,
}: {
  /** The /ach route for this payment or invoice. */
  endpoint: string;
  /** Formatted amount, shown on the button. */
  amountLabel: string;
  /** Called when a debit is on record, so the page can start polling. */
  onSubmitted?: (transfer: PayinTransfer) => void;
}) {
  const { status, refresh } = useAchAvailability(endpoint, true);
  const [holderName, setHolderName] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holderName, routingNumber, accountNumber, accountType, email: email || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Could not start the bank payment.');
        return;
      }
      setAccountNumber('');
      await refresh();
      if (body?.transfer) onSubmitted?.(body.transfer);
    } catch {
      setError('Could not start the bank payment.');
    } finally {
      setSending(false);
    }
  }

  if (!status) return <p className="text-sm text-gray-500 text-center">Checking bank payment…</p>;
  if (!status.available) {
    return <p className="text-sm text-gray-500 text-center">Bank payment is not available for this order.</p>;
  }

  const t = status.transfer;
  if (t && t.status !== 'failed' && t.status !== 'canceled') {
    return (
      <div className="space-y-3" data-testid="ach-progress">
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            t.status === 'returned'
              ? 'border border-red-500/30 bg-red-500/10 text-red-300'
              : t.status === 'completed'
                ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border border-sky-500/30 bg-sky-500/10 text-sky-300'
          }`}
        >
          {PROGRESS[t.status]}
          {t.status === 'returned' && t.returnCode ? ` (${t.returnCode})` : ''}
        </div>
        {(t.status === 'initiated' || t.status === 'pending' || t.status === 'settled') && (
          <p className="text-xs text-gray-500 text-center">
            ACH takes a few business days. The merchant is told once the funds have settled and cleared a{' '}
            {status.holdDays}-day hold. You can close this page.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="ach-form">
      {t?.status === 'failed' && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {PROGRESS.failed} {t.error ? `(${t.error})` : ''} You can try again with a different account.
        </div>
      )}
      <input
        value={holderName}
        onChange={(e) => setHolderName(e.target.value)}
        placeholder="Name on the account"
        required
        className="w-full rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder:text-gray-500"
      />
      <div className="flex gap-3">
        <input
          value={routingNumber}
          onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
          placeholder="Routing number"
          inputMode="numeric"
          required
          className="flex-1 rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder:text-gray-500"
        />
        <select
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as 'checking' | 'savings')}
          className="rounded-xl border border-gray-600 bg-gray-900 px-3 py-3 text-white"
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
        className="w-full rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder:text-gray-500"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email for your receipt (optional)"
        type="email"
        className="w-full rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder:text-gray-500"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={sending}
        className="block w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-center transition-colors text-lg"
        data-testid="pay-with-bank-btn"
      >
        {sending ? 'Submitting…' : `Pay ${amountLabel} from my bank`}
      </button>
      <p className="text-xs text-gray-500 text-center">
        By continuing you authorize a one-time ACH debit of {amountLabel} from this account. Your account number is
        sent to our bank partner and is not stored by CoinPay.
      </p>
    </form>
  );
}
