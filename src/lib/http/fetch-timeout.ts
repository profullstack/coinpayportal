/**
 * `fetch` with a deadline.
 *
 * IA-008: the balance oracles issue dozens of calls to third-party explorers
 * and RPC nodes, and not one of them set a timeout. Node's fetch has no default
 * one, so a peer that accepts a connection and then never answers holds the
 * request open indefinitely — and because the monitor awaits these calls in
 * sequence, one unresponsive upstream stalls the entire cycle. Payments stop
 * being confirmed platform-wide, and nothing errors: the cron is simply still
 * running, forever.
 *
 * A slow upstream should cost one skipped check on one address, not the run.
 */

/** Long enough for a slow explorer, short enough that a hang is not a stall. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    // Always cleared, including on the success path — an uncleared timer keeps
    // the event loop alive and would stop a short-lived cron process exiting.
    clearTimeout(timer);
  }
}
