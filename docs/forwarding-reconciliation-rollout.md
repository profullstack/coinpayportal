# Forwarding containment: rollout and reconciliation

This change contains new ambiguous forwarding attempts; it does not implement
exactly-once settlement, reconcile historical transfers, or approve a production
rollout. The API does not accept a caller-supplied private key. Do not put keys,
credentials, customer records or signed transactions in an issue or PR.

## Behavior change

- A provider exception can occur after a transfer was accepted. Such attempts
  remain `forwarding`, even if the balance still appears unchanged.
- Known pre-broadcast failures can release back to `confirmed` for retry.
- Existing `forwarding_failed` payments are no longer automatically re-confirmed
  by the late-deposit scan or reset by `retryForwardingSecurely`. Retry returns a
  reconciliation-required error and leaves the payment record unchanged.
- The scan logs a count of excluded `forwarding`/`forwarding_failed` records whose
  `updated_at` is at least 30 minutes old. Failure to read the count is an error,
  not a zero backlog. This count is a prompt for investigation, not proof of a
  failed transfer; active transfers can still appear in it.
- The exact backlog count intentionally spans all historical held records, not
  just the scan's 30-day window. Review its query plan, indexing and cron cost on
  the deployment's data size; a count timeout must not be reported as zero.
- The existing retry queue can make bounded rejected API attempts before its
  configured maximum and dead-lettering. A rejected legacy retry does not send
  funds. Inspect dead-letter entries rather than resetting their payment status.

## Before enabling production forwarding

The deployment owner must identify the person responsible for reconciliation
and record the following checklist outside public issue/PR comments.

1. Suspend forwarding producers and consumers using the deployment controls:
   in-process monitors, HTTP/edge cron, retry queues and manual forwarding access.
   Account for in-flight requests. Stopping a process is NOT proof it never sent.
2. Record the deployed revision of every worker. Stop/drain all old versions
   before enabling the new version. An old cron can reopen a new worker's claim;
   the new code cannot prevent writes made by an unchanged old worker. Rolling
   or mixed-version operation is not validated by this patch.
3. Take an authorized read-only inventory of the affected records and retained
   logs. Count them at deployment time, not from a stale QA report:

   ```sql
   SELECT status, count(*) AS affected
   FROM payments
   WHERE status IN ('forwarding', 'forwarding_failed')
   GROUP BY status;
   ```

4. Do not activate forwarding while this count is unknown, or while any affected
   record has no documented reconciliation decision and assigned operator.
   An unresolved record stays held. Owner approval of a tracked hold is not
   authorization to reset it or replay a full merchant/fee split.
5. Validate the new version in staging with synthetic funds and verify refusal
   of legacy retries, held-state preservation, backlog visibility and normal
   confirmed-payment processing. Confirm all forwarding entry points use the
   reviewed revision before re-enabling them. No paid cloud build is needed.

## Evidence for each affected payment

- Match the payment/address binding, chain, signing address, merchant and fee
  recipients, asset and intended amounts from authoritative records.
- Check stored `forward_tx_hash`, reconciliation metadata, payment-address leg
  hashes and retained provider logs. A missing hash is not evidence of no send.
- Independently inspect the appropriate chain history/receipts for BOTH legs,
  including sender nonce/signature history, pending/replaced transactions and
  finality. Do not rely on one stale balance or elapsed-time threshold. On-chain
  success also does not prove an exchange has credited the recipient account.
- If both legs are confirmed with the correct recipients/amounts, reconcile the
  record through an owner-approved administrative procedure without sending again.
- If only one leg succeeded, keep the original held; any missing-leg recovery
  must be individually scoped and approved. Never replay the entire split.
- If a transaction is pending, replaced, missing or otherwise uncertain, retain
  the hold and evidence. Only conclusive evidence of no broadcast can justify a
  separately approved reset/retry; this PR adds no reset or override endpoint.
- Completion may be recorded as `forwarded` only when the required transfer
  outcome is established. This document does not authorize `paid`, `expired` or
  other terminal labels as a way to hide an unresolved forwarding outcome.

If the old version is restored, keep producers paused until its automatic retry
behavior is reviewed against the held records. Restoring old code is not a safe
way to clear the backlog.

## Remaining boundaries

Provider validation here covers native transfers in `EthereumProvider` and its
inheriting EVM providers. It is not an audit of every token, UTXO, Solana, relayer,
collection or legacy helper path. Separate EVM legs remain non-atomic; internal
token-relayer fallback, contract-wallet gas and durable per-leg intent are still
follow-up work. Synthetic-provider DB tests do not certify chain finality or
production RLS/auth. Mobile native readiness is outside this payment patch.

The existing native EVM split can skip a leg that rounds to zero after gas-cost
scaling, and the forwarding path can record the merchant hash again as
`commission_tx_hash`. Input validation does not fix those behaviors. A stored
fee hash or `forwarded` label alone therefore does not prove that a separate fee
transfer occurred. Reconcile the actual recipient and amount for each leg;
neither duplicate hashes nor recorded fee amounts are sufficient evidence.
