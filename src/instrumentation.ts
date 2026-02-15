/**
 * Next.js Instrumentation
 * 
 * This file is automatically loaded by Next.js when the server starts.
 * We use it to start the background payment monitor.
 * 
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
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