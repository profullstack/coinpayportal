import { toUnits, fromUnits, sumAmounts, subtractAmounts, type ExactAmount } from './decimal';
import { addDays, localDate, wallClock } from './periods';

/**
 * Estimating the part of a period the institution never supplied.
 *
 * When a report starts before the earliest transaction any institution
 * handed over, the gap can be filled by extrapolation: the observed
 * period's daily mean credits and debits, multiplied by the number of
 * missing days. This is arithmetic on the observed rows, not data; it is
 * opt-in per report, computed per currency, and everything derived from it
 * is labelled "estimated" wherever it appears. It never touches the
 * observed totals, which stay exactly what the rows sum to.
 */

export interface GapEstimate {
  currency: string;
  /** Local calendar dates of the gap, [gapStart, gapEnd). */
  gapStart: string;
  gapEnd: string;
  missingDays: number;
  /** Local calendar dates the mean was measured over, [observedStart, observedEnd). */
  observedStart: string;
  observedEnd: string;
  observedDays: number;
  observedCredits: ExactAmount;
  observedDebits: ExactAmount;
  dailyMeanCredits: ExactAmount;
  dailyMeanDebits: ExactAmount;
  estimatedCredits: ExactAmount;
  estimatedDebits: ExactAmount;
  estimatedNet: ExactAmount;
  basis: string;
}

/** amount / divisor at four decimals, rounded half away from zero. Divisor must be a positive integer. */
export function divideAmount(amount: ExactAmount, divisor: number): ExactAmount {
  if (!Number.isInteger(divisor) || divisor <= 0) throw new Error('divisor must be a positive integer');
  const units = toUnits(amount);
  const d = BigInt(divisor);
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const quotient = (magnitude * 2n + d) / (2n * d);
  return fromUnits(negative ? -quotient : quotient);
}

/** amount × integer factor, exact. */
export function multiplyAmount(amount: ExactAmount, factor: number): ExactAmount {
  if (!Number.isInteger(factor) || factor < 0) throw new Error('factor must be a non-negative integer');
  return fromUnits(toUnits(amount) * BigInt(factor));
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(Number(fromDate.slice(0, 4)), Number(fromDate.slice(5, 7)) - 1, Number(fromDate.slice(8, 10)));
  const b = Date.UTC(Number(toDate.slice(0, 4)), Number(toDate.slice(5, 7)) - 1, Number(toDate.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Estimate the gap between the report start and the first observed posting
 * for one currency. Returns null when there is no gap worth estimating
 * (under two missing days, or nothing observed to measure a mean from).
 */
export function estimateLeadingGap(params: {
  currency: string;
  /** Report start and effective end, ISO instants. */
  start: string;
  end: string;
  timezone: string;
  /** Earliest posted instant among the currency's rows, or null. */
  firstPosted: string | null;
  observedCredits: ExactAmount;
  observedDebits: ExactAmount;
}): GapEstimate | null {
  if (!params.firstPosted) return null;
  const gapStart = localDate(new Date(params.start), params.timezone);
  const observedStart = localDate(new Date(params.firstPosted), params.timezone);
  const periodEnd = localDate(new Date(params.end), params.timezone);
  // An end at local midnight is exclusive of that day; an end mid-day (a
  // period-to-date cutoff) means that day was partly observed and counts.
  const endClock = wallClock(new Date(params.end), params.timezone);
  const endsAtMidnight = endClock.hour === 0 && endClock.minute === 0 && endClock.second === 0;
  const observedEnd = endsAtMidnight ? periodEnd : addDays(periodEnd, 1);
  const missingDays = daysBetween(gapStart, observedStart);
  const observedDays = daysBetween(observedStart, observedEnd);
  if (missingDays < 2 || observedDays < 1) return null;

  const dailyMeanCredits = divideAmount(params.observedCredits, observedDays);
  const dailyMeanDebits = divideAmount(params.observedDebits, observedDays);
  const estimatedCredits = multiplyAmount(dailyMeanCredits, missingDays);
  const estimatedDebits = multiplyAmount(dailyMeanDebits, missingDays);
  return {
    currency: params.currency,
    gapStart,
    gapEnd: observedStart,
    missingDays,
    observedStart,
    observedEnd,
    observedDays,
    observedCredits: params.observedCredits,
    observedDebits: params.observedDebits,
    dailyMeanCredits,
    dailyMeanDebits,
    estimatedCredits,
    estimatedDebits,
    estimatedNet: subtractAmounts(estimatedCredits, estimatedDebits),
    basis: `Daily mean of the ${observedDays} observed days (${observedStart} to ${addDays(observedEnd, -1)}) applied to the ${missingDays} days the institutions supplied nothing for (${gapStart} to ${addDays(observedStart, -1)}). Not observed transactions.`,
  };
}

/** Observed totals plus the estimate, per currency. */
export function combineWithEstimate(
  observed: { credits: ExactAmount; debits: ExactAmount },
  estimate: GapEstimate,
): { credits: ExactAmount; debits: ExactAmount; net: ExactAmount } {
  const credits = sumAmounts([observed.credits, estimate.estimatedCredits]);
  const debits = sumAmounts([observed.debits, estimate.estimatedDebits]);
  return { credits, debits, net: subtractAmounts(credits, debits) };
}
