/**
 * Batch payment runner — pay many recipients from one approval.
 *
 * Each payment is an independent on-chain transaction; there is no such thing
 * as an atomic 62-way transfer. So the contract here is deliberately
 * **partial-success**: every item reports its own outcome, one failure never
 * cancels the rest, and the caller reconciles from the per-item results. For a
 * payables run (e.g. 62 accepted invoices) finishing 61 and reporting 1 failure
 * is far better than aborting after 20.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * Transactions on the same account must go ONE AT A TIME, because the server
 * derives chain state per prepare-tx call:
 *
 *   EVM      `eth_getTransactionCount(from, 'pending')` — preparing two txs
 *            before broadcasting either yields the SAME nonce, so the second
 *            replaces (not follows) the first.
 *   BTC/BCH  the full UTXO set is spent as inputs with one change output back.
 *            Item N+1 must see N's change UTXO or it will build a tx from
 *            already-spent inputs.
 *
 * Hence: items are grouped into per-account queues, queues run concurrently
 * (Solana and Polygon don't block each other), and within a queue we strictly
 * serialize prepare → sign → broadcast, then wait `settleDelayMs` for the
 * network's view to catch up before the next item.
 *
 * That delay is a heuristic, not a guarantee, so transient chain-state errors
 * ("nonce too low", "inputs missing or spent") are retried with backoff rather
 * than surfaced. Errors that retrying cannot fix — insufficient funds, a bad
 * address — fail the item immediately.
 */

import { signTransaction } from './signing.js';
import { derivePrivateKey } from './private-keys.js';
import { signingChain, nonceQueueKey, toPayChain, type PayChain } from './pay-chains.js';
import type { CoinPayApi } from './api.js';
import type { NativeChain } from './chains.js';

export interface BatchPaymentRequest {
  /** Caller's correlation id (e.g. a ugig.net invoice id). Echoed in results. */
  id: string;
  chain: PayChain;
  /** Recipient address. */
  to: string;
  /** Amount in the chain's display units, as a decimal string. */
  amount: string;
  /** Human label for the approval screen ("Ada Lovelace — Fix login bug"). */
  label?: string;
  /** Fiat value for the approval summary only; never used for the transfer. */
  amountUsd?: number;
}

export type BatchItemStage =
  | 'queued'
  | 'preparing'
  | 'signing'
  | 'broadcasting'
  | 'sent'
  | 'failed'
  | 'skipped';

export interface BatchItemResult {
  id: string;
  chain: PayChain;
  to: string;
  amount: string;
  status: 'sent' | 'failed' | 'skipped';
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface BatchProgress {
  id: string;
  stage: BatchItemStage;
  /** Populated once broadcast succeeds. */
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  /** Items finished (sent + failed + skipped) out of the total. */
  completed: number;
  total: number;
}

export interface BatchRunnerOptions {
  api: CoinPayApi;
  walletId: string;
  /** Raw BIP-39 seed; per-chain keys are derived, used, and zeroed per item. */
  seed: Uint8Array;
  /** Signs API auth headers — the secp256k1 key registered with the portal. */
  authKey: Uint8Array;
  /**
   * Sender per signing chain: the address to spend from AND the derivation
   * index behind it.
   *
   * Index travels WITH the address because each chain advances independently —
   * BTC can be on index 2 while POL is still on 0. A single shared index signs
   * one chain's transaction with another chain's key, which the network
   * rejects; that shipped once already.
   */
  senders: Partial<Record<NativeChain, { address: string; index: number }>>;
  onProgress?: (progress: BatchProgress) => void;
  signal?: AbortSignal;
  /** Overridable for tests, which would otherwise wait out the real delays. */
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * How long to let the network absorb a broadcast before preparing the next
 * transaction from the same account. UTXO chains need the most: a change output
 * has to reach the indexer the server queries.
 */
function settleDelayMs(chain: NativeChain): number {
  switch (chain) {
    case 'BTC':
    case 'BCH':
      return 8000;
    case 'ETH':
    case 'POL':
      return 1500;
    case 'SOL':
      return 1000;
  }
}

/**
 * The node already has this exact transaction.
 *
 * `already known` is not a failure at all — the broadcast SUCCEEDED and the
 * node is telling us it has seen it. It was previously classified as transient,
 * so the runner rebuilt the payment from scratch and broadcast it AGAIN: a
 * second, real, duplicate payment. This is the single most dangerous string in
 * the list, because the response that means "your money moved" was treated as
 * "try again".
 */
export function isAlreadyBroadcast(message: string): boolean {
  return /already known|already in (the )?(block ?chain|mempool)|duplicate transaction|txn-already-known/i.test(
    message,
  );
}

/**
 * Retry only when the transaction definitely did NOT reach the chain.
 *
 * The previous list conflated two very different things: errors meaning "the
 * request never landed" and errors meaning "something already consumed this
 * transaction's inputs". Retrying the first is free; retrying the second sends
 * the payment twice, because re-preparing picks fresh state and produces a
 * second valid transaction.
 *
 * Deliberately NOT retried any more, and why:
 *
 *   already known                        the broadcast succeeded (see above)
 *   nonce too low                        an earlier tx with that nonce is mined
 *   replacement transaction underpriced  one with that nonce is already pending
 *   missingorspent / utxo / mempool-conflict
 *                                        the input is gone — plausibly spent by
 *                                        our own previous attempt
 *
 * Each of those describes chain state that has moved *because a transaction
 * like ours already exists*. That is precisely when a retry duplicates a
 * payment, and none of them can be distinguished from the benign case without
 * asking the chain — which the runner does not do.
 */
export function isTransientChainError(message: string): boolean {
  if (isAlreadyBroadcast(message)) return false;
  return /blockhash not found|block height exceeded|rate limit|timeout|temporarily|econnreset|network error|502|503|504/i.test(
    message,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a batch of payments. Resolves once every item has a terminal outcome;
 * it does not reject on individual failures — inspect the returned results.
 */
export async function runBatchPayments(
  requests: BatchPaymentRequest[],
  options: BatchRunnerOptions,
): Promise<BatchItemResult[]> {
  const {
    api,
    walletId,
    seed,
    authKey,
    senders,
    onProgress,
    signal,
    sleep = defaultSleep,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = options;

  const total = requests.length;
  let completed = 0;
  const results = new Map<string, BatchItemResult>();

  const report = (
    request: BatchPaymentRequest,
    stage: BatchItemStage,
    extra: { txHash?: string; explorerUrl?: string; error?: string } = {},
  ): void => {
    onProgress?.({ id: request.id, stage, completed, total, ...extra });
  };

  const finish = (
    request: BatchPaymentRequest,
    result: Omit<BatchItemResult, 'id' | 'chain' | 'to' | 'amount'>,
  ): void => {
    results.set(request.id, {
      id: request.id,
      chain: request.chain,
      to: request.to,
      amount: request.amount,
      ...result,
    });
    completed++;
    report(request, result.status === 'sent' ? 'sent' : result.status, {
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      error: result.error,
    });
  };

  /** prepare → sign → broadcast for one payment. Throws on failure. */
  const payOnce = async (request: BatchPaymentRequest): Promise<BatchItemResult> => {
    const signer = signingChain(request.chain);
    const sender = senders[signer];
    if (!sender) {
      throw new Error(`Wallet has no ${signer} address to send from`);
    }

    report(request, 'preparing');
    const prepared = await api.prepareTx(walletId, authKey, {
      from_address: sender.address,
      to_address: request.to,
      chain: request.chain,
      amount: request.amount,
    });

    report(request, 'signing');
    const privateKey = derivePrivateKey(seed, signer, sender.index);
    let signed: string;
    try {
      const result = await signTransaction({
        unsigned_tx: prepared.unsigned_tx,
        privateKey: Array.from(privateKey, (b) => b.toString(16).padStart(2, '0')).join(''),
      });
      signed = result.signed_tx;
    } finally {
      // Key material lives only as long as the signature it produces.
      privateKey.fill(0);
    }

    report(request, 'broadcasting');
    const broadcasted = await api.broadcast(walletId, authKey, {
      tx_id: prepared.tx_id,
      signed_tx: signed,
      chain: request.chain,
    });

    return {
      id: request.id,
      chain: request.chain,
      to: request.to,
      amount: request.amount,
      status: 'sent',
      txHash: broadcasted.tx_hash,
      explorerUrl: broadcasted.explorer_url,
    };
  };

  /** One account's payments, strictly in order. */
  const runQueue = async (queue: BatchPaymentRequest[], account: NativeChain): Promise<void> => {
    for (const request of queue) {
      if (signal?.aborted) {
        finish(request, { status: 'skipped', error: 'Cancelled before this payment was sent' });
        continue;
      }

      report(request, 'queued');
      let lastError = '';
      let sent = false;

      for (let attempt = 1; attempt <= maxAttempts && !sent; attempt++) {
        try {
          const result = await payOnce(request);
          results.set(request.id, result);
          completed++;
          report(request, 'sent', { txHash: result.txHash, explorerUrl: result.explorerUrl });
          sent = true;
        } catch (err) {
          lastError = errorMessage(err);

          // The node already has it: the payment went through. Retrying would
          // send a second one.
          if (isAlreadyBroadcast(lastError)) {
            results.set(request.id, {
              id: request.id,
              chain: request.chain,
              to: request.to,
              amount: request.amount,
              status: 'sent',
              txHash: undefined,
              explorerUrl: undefined,
            });
            completed++;
            report(request, 'sent');
            sent = true;
            break;
          }

          const canRetry = attempt < maxAttempts && isTransientChainError(lastError);
          if (!canRetry) break;
          // Back off and let chain state settle before rebuilding the tx.
          await sleep(settleDelayMs(account) * attempt);
        }
      }

      if (!sent) {
        finish(request, { status: 'failed', error: lastError || 'Payment failed' });
        // A failed broadcast consumes no nonce and spends no UTXO, so the next
        // item can proceed immediately against unchanged state.
        continue;
      }

      // Give the network time to reflect this send before building the next.
      const isLast = queue[queue.length - 1] === request;
      if (!isLast) await sleep(settleDelayMs(account));
    }
  };

  // Group into per-account queues. Insertion order is preserved so payments go
  // out in the order the user saw them on the approval screen.
  const queues = new Map<NativeChain, BatchPaymentRequest[]>();
  for (const request of requests) {
    const key = nonceQueueKey(request.chain);
    const queue = queues.get(key);
    if (queue) queue.push(request);
    else queues.set(key, [request]);
  }

  await Promise.all([...queues.entries()].map(([account, queue]) => runQueue(queue, account)));

  // Return in the caller's original order so the UI can zip results to rows.
  return requests.map(
    (request) =>
      results.get(request.id) ?? {
        id: request.id,
        chain: request.chain,
        to: request.to,
        amount: request.amount,
        status: 'failed' as const,
        error: 'Payment did not run',
      },
  );
}

/**
 * Validate a batch request that arrived from an untrusted web page.
 *
 * Everything here is attacker-controlled, and the approval screen is only
 * meaningful if it describes what will actually be signed — so anything
 * ambiguous is rejected outright rather than coerced into something plausible.
 * In particular a duplicate id is fatal: for a payables run that ambiguity is
 * exactly how someone gets paid twice.
 *
 * Throws on the first problem, naming the offending payment.
 */
export function parseBatchRequests(payments: unknown, maxSize: number): BatchPaymentRequest[] {
  if (!Array.isArray(payments) || payments.length === 0) {
    throw new Error('No payments supplied');
  }
  if (payments.length > maxSize) {
    throw new Error(`Too many payments in one batch (max ${maxSize})`);
  }

  const seen = new Set<string>();
  return payments.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    const to = typeof item.to === 'string' ? item.to.trim() : '';
    const amount = String(item.amount ?? '').trim();
    const chain = toPayChain(typeof item.chain === 'string' ? item.chain : null);

    if (!id) throw new Error(`Payment #${index + 1} is missing an id`);
    if (seen.has(id)) throw new Error(`Duplicate payment id: ${id}`);
    seen.add(id);
    if (!to) throw new Error(`Payment ${id} is missing a recipient address`);
    if (!chain) throw new Error(`Payment ${id} has an unsupported chain`);
    // Rejects NaN, Infinity, negatives, and zero in one check.
    if (!(Number(amount) > 0) || !Number.isFinite(Number(amount))) {
      throw new Error(`Payment ${id} has an invalid amount`);
    }

    return {
      id,
      chain,
      to,
      amount,
      label: typeof item.label === 'string' ? item.label.slice(0, 200) : undefined,
      amountUsd: typeof item.amountUsd === 'number' ? item.amountUsd : undefined,
    };
  });
}

/** Per-chain totals for the approval screen. */
export function summarizeBatch(
  requests: BatchPaymentRequest[],
): { chain: PayChain; count: number; total: string; totalUsd: number }[] {
  const groups = new Map<PayChain, { count: number; total: number; totalUsd: number }>();
  for (const request of requests) {
    const group = groups.get(request.chain) ?? { count: 0, total: 0, totalUsd: 0 };
    group.count++;
    group.total += Number(request.amount) || 0;
    group.totalUsd += request.amountUsd || 0;
    groups.set(request.chain, group);
  }
  return [...groups.entries()].map(([chain, group]) => ({
    chain,
    count: group.count,
    // 8 decimals covers BTC's satoshi precision; trailing zeros trimmed.
    total: group.total.toFixed(8).replace(/\.?0+$/, ''),
    totalUsd: group.totalUsd,
  }));
}

/** What the approval screen shows about whether a run can actually be paid. */
export interface BatchFunding {
  chain: PayChain;
  /** The address that will fund this chain's payments, if one is derived. */
  address?: string;
  /** Sum of this chain's payments, in display units. */
  required: string;
  /** What that address holds, in display units. */
  available: string;
  /** False when the balance cannot cover the total. Fees are NOT included. */
  sufficient: boolean;
}

/**
 * Compare what a batch needs against what the funding addresses hold.
 *
 * A wallet can hold several addresses per chain, and a batch spends exactly one
 * of them — so "the wallet has enough" is not the question. The question is
 * whether *the address that will pay* has enough, which is what this answers
 * and what the approval screen shows. A run that is short fails one payment at
 * a time with chain-level errors ("No UTXOs available", "simulation failed")
 * that never say the word "balance".
 *
 * `sufficient` deliberately ignores transaction fees: the exact cost is not
 * known until each transaction is built, and quietly padding it would report a
 * shortfall that is not real. Treat it as necessary, not sufficient.
 */
export function computeFunding(
  payments: BatchPaymentRequest[],
  senders: Partial<Record<NativeChain, { address: string; index: number }>>,
  balances: { chain?: string; address?: string; balance?: string }[],
): BatchFunding[] {
  const required = new Map<PayChain, number>();
  for (const payment of payments) {
    const amount = Number(payment.amount);
    required.set(
      payment.chain,
      (required.get(payment.chain) ?? 0) + (Number.isFinite(amount) ? amount : 0),
    );
  }

  return [...required.entries()].map(([chain, amount]) => {
    const address = senders[signingChain(chain)]?.address;
    // Only the funding address counts. Summing every address on the chain is
    // what makes an empty sender look funded.
    const available = balances
      .filter(
        (b) =>
          (b.chain ?? '').toUpperCase() === chain &&
          (!address || (b.address ?? '').toLowerCase() === address.toLowerCase()),
      )
      .reduce((sum, b) => {
        const value = Number(b.balance);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);

    return {
      chain,
      address,
      required: String(amount),
      available: String(available),
      sufficient: available >= amount,
    };
  });
}
