/**
 * Retracting a failed forward once the money actually lands.
 *
 * When `forwardPaymentSecurely` fails after claiming a payment, it stamps the
 * row with `reconciliation_required`, a `forwarding_error` and a
 * `forwarding_failed_at` — deliberately, because a failure mid-broadcast is not
 * proof that nothing was sent, and an operator has to look before anything
 * retries.
 *
 * Nothing ever took those marks off. Found on 2026-09-24: a USDC payment failed
 * on an empty gas relayer, the relayer was topped up, the retry swept the funds
 * to the merchant and wrote `status = 'forwarded'` — and the row kept all three
 * keys, because the success path never touched metadata. The payment was
 * settled and flagged for manual reconciliation at the same time, permanently,
 * and any queue built on that flag would have shown it forever.
 *
 * The success path is exactly where the question gets answered: the funds moved
 * and we hold the hashes, so there is nothing left to reconcile.
 */

/** The marks a failed forwarding attempt leaves behind. */
const FAILURE_KEYS = ['reconciliation_required', 'forwarding_error', 'forwarding_failed_at'] as const;

export interface SettledMetadata {
  /** True when the row carried marks from an earlier failed attempt. */
  changed: boolean;
  /**
   * The metadata to write. Only meaningful when `changed` — callers skip the
   * metadata write entirely otherwise, so an ordinary first-try forward does
   * not rewrite a bag it has no reason to touch.
   */
  metadata: Record<string, unknown>;
}

/**
 * Clear a previous failure's marks, keeping everything else in the bag.
 *
 * The error is preserved under `resolved_forwarding_error` and the moment of
 * resolution recorded: what went wrong is still worth reading afterwards, it
 * just is not an open question any more.
 */
export function settleForwardingMetadata(
  priorMetadata: unknown,
  resolvedAt: string = new Date().toISOString(),
): SettledMetadata {
  const prior = (priorMetadata && typeof priorMetadata === 'object' && !Array.isArray(priorMetadata))
    ? { ...(priorMetadata as Record<string, unknown>) }
    : {};

  const changed = FAILURE_KEYS.some((key) => key in prior);
  if (!changed) return { changed: false, metadata: prior };

  const priorError = prior.forwarding_error;
  for (const key of FAILURE_KEYS) delete prior[key];

  return {
    changed: true,
    metadata: {
      ...prior,
      reconciliation_resolved_at: resolvedAt,
      ...(priorError ? { resolved_forwarding_error: priorError } : {}),
    },
  };
}
