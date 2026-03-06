#!/usr/bin/env -S npx tsx
/**
 * Payment & Escrow Monitor Service
 * 
 * Long-running background service that polls the monitor endpoint.
 * Runs alongside the Next.js app on Railway.
 * 
 * Interval: 15 seconds (configurable via MONITOR_INTERVAL_MS)
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
const API_KEY = process.env.INTERNAL_API_KEY || "";
const INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || "15000");
const STARTUP_DELAY_MS = parseInt(process.env.MONITOR_STARTUP_DELAY_MS || "30000");

let running = true;
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 min max backoff

async function runCycle(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${APP_URL}/api/cron/monitor-payments`, {
      method: "GET",
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      consecutiveErrors = 0;

      // Only log if something happened
      const escrow = data.escrow || {};
      const stats = data.stats || {};
      const ln = data.lightning || {};
      const inv = data.invoices || {};

      const activity = (escrow.funded || 0) + (escrow.expired || 0) + 
        (stats.confirmed || 0) + (ln.settled || 0) + (inv.detected || 0);

      if (activity > 0) {
        console.log(`[Monitor] Activity:`, JSON.stringify({
          escrow: escrow.funded || escrow.expired ? escrow : undefined,
          payments: stats.confirmed ? stats : undefined,
          lightning: ln.settled ? ln : undefined,
          invoices: inv.detected ? inv : undefined,
        }));
      }
    } else {
      const text = await res.text().catch(() => "");
      console.error(`[Monitor] HTTP ${res.status}: ${text.slice(0, 200)}`);
      consecutiveErrors++;
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error("[Monitor] Request timed out (30s)");
    } else {
      console.error(`[Monitor] Error: ${err.message}`);
    }
    consecutiveErrors++;
  }
}

async function main() {
  console.log(`[Monitor] Starting payment monitor service`);
  console.log(`[Monitor] URL: ${APP_URL}/api/cron/monitor-payments`);
  console.log(`[Monitor] Interval: ${INTERVAL_MS}ms, startup delay: ${STARTUP_DELAY_MS}ms`);

  if (!API_KEY) {
    console.error("[Monitor] WARNING: INTERNAL_API_KEY not set — requests will be unauthorized");
  }

  // Wait for the app to start up
  await new Promise(r => setTimeout(r, STARTUP_DELAY_MS));
  console.log("[Monitor] Startup delay complete, beginning monitor cycles");

  while (running) {
    await runCycle();

    // Exponential backoff on consecutive errors (15s → 30s → 60s → ... → 5min)
    const backoff = consecutiveErrors > 0
      ? Math.min(INTERVAL_MS * Math.pow(2, consecutiveErrors - 1), MAX_BACKOFF_MS)
      : INTERVAL_MS;

    if (backoff > INTERVAL_MS) {
      console.log(`[Monitor] Backing off: ${Math.round(backoff / 1000)}s (${consecutiveErrors} consecutive errors)`);
    }

    await new Promise(r => setTimeout(r, backoff));
  }
}

process.on("SIGTERM", () => { running = false; console.log("[Monitor] Shutting down..."); });
process.on("SIGINT", () => { running = false; console.log("[Monitor] Shutting down..."); });

main().catch(err => {
  console.error("[Monitor] Fatal:", err);
  process.exit(1);
});
