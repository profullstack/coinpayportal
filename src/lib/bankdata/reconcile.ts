/**
 * Settlement reconciliation — pure, no DB, no network.
 *
 * The question a merchant actually asks is "CoinPay says it paid me; did the money
 * arrive?" Answering it means pairing each expected settlement with the bank credit
 * that represents it. Banks do not echo our identifiers, so the match is heuristic:
 * exact amount, plus a short window after the settlement date.
 *
 * The design rule throughout: **never invent a match**. An unmatched settlement is a
 * useful, honest answer that a human can chase. A wrong match is a reconciliation that
 * reports "all settled" while money is genuinely missing, which is far worse than no
 * feature at all. Where the evidence is ambiguous we say so rather than picking.
 */

import type { BankTransaction } from './types';

/** A payout CoinPay believes it made, awaiting confirmation in the merchant's bank. */
export interface ExpectedSettlement {
  /** Our id for the settlement (e.g. a `stripe_payouts.id`). */
  id: string;
  /** Always positive: the amount we expect to see land, in minor units. */
  amountMinor: number;
  currency: string;
  /** Date we initiated/reported it, ISO `YYYY-MM-DD`. */
  date: string;
}

export interface ReconciliationMatch {
  settlement: ExpectedSettlement;
  transaction: BankTransaction;
  /** Whole days between the settlement date and the bank post date. */
  dayGap: number;
  /**
   * True when another credit fit exactly as well. The pairing shown is deterministic
   * but not evidence; surface these for a human rather than reporting them as settled.
   */
  ambiguous: boolean;
}

export interface ReconciliationResult {
  matched: ReconciliationMatch[];
  /** Settlements with no corresponding credit — the ones worth chasing. */
  unmatchedSettlements: ExpectedSettlement[];
  /** Credits that no settlement explains (other income, refunds, manual transfers). */
  unmatchedCredits: BankTransaction[];
}

export interface ReconcileOptions {
  /**
   * How many days after the settlement date a credit may post and still count.
   * Default 5: ACH is 1-3 business days, and a weekend plus a holiday reaches 5.
   */
  windowDays?: number;
}

const DEFAULT_WINDOW_DAYS = 5;
const MS_PER_DAY = 86_400_000;

/** Parse an ISO `YYYY-MM-DD` as UTC midnight. Returns NaN for anything malformed. */
function parseDate(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

/**
 * Match expected settlements against bank credits.
 *
 * Greedy by closeness, one-to-one: a bank credit can only settle a single payout, and a
 * payout can only be settled once. Settlements are processed oldest-first so that when
 * two identical amounts are outstanding, the older one claims the earlier credit — the
 * ordering a human would apply.
 */
export function reconcileSettlements(
  settlements: ExpectedSettlement[],
  transactions: BankTransaction[],
  options: ReconcileOptions = {},
): ReconciliationResult {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Only settled credits are evidence. Pending rows can still change both id and
  // amount, so matching against them would produce results that later become false.
  const credits = transactions.filter((t) => !t.pending && t.amountMinor > 0);

  const ordered = [...settlements].sort((a, b) => a.date.localeCompare(b.date));
  const claimed = new Set<string>();

  const matched: ReconciliationMatch[] = [];
  const unmatchedSettlements: ExpectedSettlement[] = [];

  for (const settlement of ordered) {
    const settlementDate = parseDate(settlement.date);

    const candidates = credits
      .filter((credit) => {
        if (claimed.has(credit.providerTransactionId)) return false;
        if (credit.amountMinor !== settlement.amountMinor) return false;
        if (credit.currency !== settlement.currency) return false;

        const creditDate = parseDate(credit.date);
        if (Number.isNaN(creditDate) || Number.isNaN(settlementDate)) return false;

        // Money cannot land before it was sent, so the window is one-sided.
        const gap = (creditDate - settlementDate) / MS_PER_DAY;
        return gap >= 0 && gap <= windowDays;
      })
      .map((credit) => ({
        credit,
        dayGap: Math.round((parseDate(credit.date) - settlementDate) / MS_PER_DAY),
      }))
      // Closest first; ties broken on the provider id purely for determinism, so the
      // same inputs always produce the same output.
      .sort(
        (a, b) =>
          a.dayGap - b.dayGap ||
          a.credit.providerTransactionId.localeCompare(b.credit.providerTransactionId),
      );

    if (candidates.length === 0) {
      unmatchedSettlements.push(settlement);
      continue;
    }

    const best = candidates[0];
    claimed.add(best.credit.providerTransactionId);
    matched.push({
      settlement,
      transaction: best.credit,
      dayGap: best.dayGap,
      // Equally-close alternatives mean the pairing is a guess, not a finding.
      ambiguous: candidates.length > 1 && candidates[1].dayGap === best.dayGap,
    });
  }

  return {
    matched,
    unmatchedSettlements,
    unmatchedCredits: credits.filter((c) => !claimed.has(c.providerTransactionId)),
  };
}
