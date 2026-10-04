// Print the provider-safe fetch windows for a custom range, as JSON, so a
// backfill job can be created by hand when no session is available.
// usage: node --import tsx scripts/plan-windows.mts 2026-01-01 2026-09-13 America/Los_Angeles
import { resolvePeriod, boundPeriod, planFetchWindows } from '../src/lib/finances/periods';

const [from, to, timezone = 'UTC'] = process.argv.slice(2);
const period = resolvePeriod({ from, to, timezone });
const bounded = boundPeriod(period, new Date());
const windows = planFetchWindows(period, { cutoff: new Date(bounded.effectiveEnd) });
console.log(
  JSON.stringify({
    period: period.selector,
    periodLabel: period.label,
    timezone: period.timezone,
    start: period.start,
    end: period.end,
    effectiveEnd: bounded.effectiveEnd,
    periodToDate: bounded.periodToDate,
    windows,
    requestsPlanned: windows.length,
  }),
);
