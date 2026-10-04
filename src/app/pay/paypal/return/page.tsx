'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Where PayPal returns the payer after they approve an order.
 *
 * This page captures the order so the payer sees a settled receipt instead of a
 * spinner. It is a convenience, not the source of truth: the
 * PAYMENT.CAPTURE.COMPLETED webhook settles the same payment independently, and
 * settlement is idempotent, so closing this tab early costs the payer a receipt
 * but never the payment.
 */

type State =
  | { kind: 'working' }
  | { kind: 'paid'; amount: string | null; currency: string | null }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

function PaypalReturnInner() {
  const searchParams = useSearchParams();

  // PayPal calls the order id `token` on the return URL. We also pass our own
  // transaction id when we built the URL, which is the more reliable handle.
  const token = searchParams?.get('token') ?? null;
  const transactionId = searchParams?.get('transaction_id') ?? null;
  // PayPal sends the payer here with cancelled=1 when they back out.
  const cancelled = !!searchParams?.get('cancelled');

  // Everything decidable from the URL is decided during render. Only the case
  // that needs a network call starts as 'working', which keeps the effect free
  // of synchronous setState.
  const [state, setState] = useState<State>(() => {
    if (cancelled) return { kind: 'cancelled' };
    if (!token && !transactionId) {
      return { kind: 'failed', message: 'This link is missing its payment reference.' };
    }
    return { kind: 'working' };
  });

  // React mounts effects twice in development. Without this the capture fires
  // twice on every local run, which is harmless but makes the logs lie.
  const started = useRef(false);

  const capture = useCallback(async () => {
    try {
      const res = await fetch('/api/paypal/payments/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(token ? { order_id: token } : {}),
          ...(transactionId ? { transaction_id: transactionId } : {}),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setState({ kind: 'paid', amount: data.amount ?? null, currency: data.currency ?? null });
      } else {
        setState({
          kind: 'failed',
          message: data.error || 'We could not confirm this payment with PayPal.',
        });
      }
    } catch {
      setState({
        kind: 'failed',
        message: 'We could not reach CoinPay to confirm this payment.',
      });
    }
  }, [token, transactionId]);

  useEffect(() => {
    // Nothing to do unless the URL actually described a capturable payment.
    if (cancelled || (!token && !transactionId)) return;
    if (started.current) return;
    started.current = true;
    // set-state-in-effect flags this because capture() eventually calls
    // setState. It only ever does so after awaiting the network, which is the
    // "subscribe to an external system" case the rule exempts — it just cannot
    // see through the async boundary. Every synchronous decision was already
    // moved into the useState initializer above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    capture();
  }, [capture, cancelled, token, transactionId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
        {state.kind === 'working' && (
          <>
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#0070ba] mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
              Confirming your payment…
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Please don&apos;t close this window.
            </p>
          </>
        )}

        {state.kind === 'paid' && (
          <>
            <div className="text-5xl">✅</div>
            <h1 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">Payment complete</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {state.amount
                ? `Your payment of ${state.amount} ${state.currency ?? ''} went through. `
                : 'Your payment went through. '}
              PayPal has emailed you a receipt.
            </p>
          </>
        )}

        {state.kind === 'cancelled' && (
          <>
            <div className="text-5xl">↩️</div>
            <h1 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
              Payment cancelled
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              You cancelled before paying, so nothing was charged. You can close this window or go
              back and try again.
            </p>
          </>
        )}

        {state.kind === 'failed' && (
          <>
            <div className="text-5xl">⚠️</div>
            <h1 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
              We couldn&apos;t confirm this payment
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{state.message}</p>
            {/* Said plainly because the alternative is a payer who pays twice:
                PayPal may still have taken the money and told us separately. */}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              If PayPal has already charged you, the payment will still be recorded — check your
              PayPal activity before paying again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaypalReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#0070ba]" />
        </div>
      }
    >
      <PaypalReturnInner />
    </Suspense>
  );
}
