/**
 * Next.js Instrumentation
 * 
 * This file is automatically loaded by Next.js when the server starts.
 * We use it to start the background payment monitor.
 * 
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';

let posthogLoggerInitialized = false;

function registerPostHogLogger() {
  if (posthogLoggerInitialized) return;

  const authToken = process.env.POSTHOG_LOGS_AUTH_TOKEN;
  if (!authToken) {
    console.log('[Instrumentation] PostHog logs disabled (POSTHOG_LOGS_AUTH_TOKEN not set)');
    return;
  }

  const serviceName = process.env.POSTHOG_LOGS_SERVICE_NAME || 'coinpayportal';
  const exporter = new OTLPLogExporter({
    url: process.env.POSTHOG_LOGS_OTLP_URL || 'https://us.i.posthog.com/otlp/v1/logs',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  const loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'deployment.environment': process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'unknown',
    }),
    processors: [new SimpleLogRecordProcessor({ exporter })],
  });

  (globalThis as any).__posthogLogger = loggerProvider.getLogger(serviceName);
  (globalThis as any).__posthogLoggerProvider = loggerProvider;
  posthogLoggerInitialized = true;
  console.log('[Instrumentation] PostHog logs enabled');
}

export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail closed: production must have its own OIDC_SIGNING_SECRET, never
    // JWT_SECRET (which equals the Supabase JWT secret). Throwing here stops
    // the server from booting, so the deploy health check fails loudly.
    const { assertOidcSigningSecret } = await import('./lib/oauth/tokens');
    assertOidcSigningSecret();

    registerPostHogLogger();

    // The finance job worker: backfills, scheduled syncs and report
    // generation. Runs in-process alongside the payment monitor unless
    // switched off; a deployment that prefers a scheduler can set
    // FINANCES_WORKER_ENABLED=false and hit /api/cron/finance-worker instead.
    const enableFinanceWorker =
      process.env.FINANCES_WORKER_ENABLED === 'true' ||
      (process.env.FINANCES_WORKER_ENABLED !== 'false' && process.env.ENABLE_BACKGROUND_MONITOR === 'true');
    if (enableFinanceWorker) {
      try {
        const { startFinanceWorkerLoop } = await import('./lib/finances/jobs');
        startFinanceWorkerLoop();
        // No bank keep-alive loop: the cloud bank browser is off for good (lib/finances/cloud-disabled).
      } catch (err) {
        console.error('[Instrumentation] finance worker failed to start', err instanceof Error ? err.message : err);
      }
    } else {
      console.log('[Instrumentation] Finance worker disabled');
    }

    // Operator keys (SYSTEM_MNEMONIC_*, sealed to the operator vault): every
    // 10 minutes, log the alert line while they are locked (throttled to
    // hourly) and keep the deposit-address pool topped up while unlocked.
    try {
      const { startOperatorKeysWatch } = await import('./lib/wallets/operator-watch');
      startOperatorKeysWatch();
    } catch (err) {
      console.error('[Instrumentation] operator keys watch failed to start', err instanceof Error ? err.message : err);
    }

    // Merchant webhook retries (@profullstack/webhooks outbox). Started on every
    // server process: the claim is FOR UPDATE SKIP LOCKED, so several processes
    // never send the same delivery. WEBHOOKS_HUB=off switches the hub off.
    try {
      const { startWebhooksHub, webhooksHubEnabled } = await import('./lib/webhooks/hub');
      if (webhooksHubEnabled()) {
        startWebhooksHub();
        console.log('[Instrumentation] Webhooks hub drainer started');
      } else {
        console.log('[Instrumentation] Webhooks hub disabled (WEBHOOKS_HUB=off)');
      }
    } catch (err) {
      console.error('[Instrumentation] webhooks hub failed to start', err instanceof Error ? err.message : err);
    }

    const enableBackgroundMonitor = process.env.ENABLE_BACKGROUND_MONITOR === 'true';
    if (!enableBackgroundMonitor) {
      console.log('[Instrumentation] Background monitor disabled (ENABLE_BACKGROUND_MONITOR != true)');
      return;
    }
    // Catch unhandled errors to prevent server crashes
    process.on('uncaughtException', (err) => {
      console.error('[FATAL] Uncaught exception (caught by handler):', err?.message || err);
      console.error(err?.stack || '');
      // Don't exit — let the server keep running
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[FATAL] Unhandled rejection (caught by handler):', reason);
    });

    console.log('[Instrumentation] Starting background services...');
    
    // Dynamically import to avoid issues with client-side bundling
    const { startMonitor } = await import('./lib/payments/monitor');
    
    // Start the payment monitor
    startMonitor();
    
    console.log('[Instrumentation] Background services started');
  }
}
