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
    processors: [new SimpleLogRecordProcessor(exporter)],
  });

  (globalThis as any).__posthogLogger = loggerProvider.getLogger(serviceName);
  (globalThis as any).__posthogLoggerProvider = loggerProvider;
  posthogLoggerInitialized = true;
  console.log('[Instrumentation] PostHog logs enabled');
}

export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    registerPostHogLogger();

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
