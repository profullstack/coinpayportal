/**
 * Per-person daily question cap for Ask Your Data.
 *
 * Every question is a paid model call against an Anthropic budget that is capped
 * for the whole platform, so one busy account must not be able to spend it. The
 * counter is in process memory, keyed by merchant and UTC day: coinpayportal runs
 * as one container, and a restart forgiving the day's count is an acceptable miss.
 */

const DEFAULT_LIMIT = Number(process.env.ASK_DATA_DAILY_LIMIT) || 40;
const ADMIN_LIMIT = Number(process.env.ASK_DATA_ADMIN_DAILY_LIMIT) || 200;

const counts = new Map<string, number>();
let countsDay = '';

function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function roll(now: Date = new Date()) {
  const day = today(now);
  if (day !== countsDay) {
    counts.clear();
    countsDay = day;
  }
}

export function askAllowance(merchantId: string, isAdmin: boolean, now: Date = new Date()): { limit: number; used: number; remaining: number } {
  roll(now);
  const limit = isAdmin ? ADMIN_LIMIT : DEFAULT_LIMIT;
  const used = counts.get(merchantId) ?? 0;
  return { limit, used, remaining: Math.max(0, limit - used) };
}

export function recordAsk(merchantId: string, now: Date = new Date()): void {
  roll(now);
  counts.set(merchantId, (counts.get(merchantId) ?? 0) + 1);
}

/** Test hook. */
export function resetAskLimits(): void {
  counts.clear();
  countsDay = '';
}
