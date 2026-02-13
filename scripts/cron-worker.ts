#!/usr/bin/env tsx
/**
 * Cron Worker Service for Railway
 * 
 * Runs periodic jobs internally without external triggers.
 * Deploy as a separate Railway service with: npx tsx scripts/cron-worker.ts
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : 'http://localhost:3000';

const CRON_SECRET = process.env.CRON_SECRET || '';

interface CronJob {
  name: string;
  path: string;
  intervalMs: number;
  method?: 'GET' | 'POST';
}

const jobs: CronJob[] = [
  {
    name: 'monitor-payments',
    path: '/api/cron/monitor-payments',
    intervalMs: 60 * 1000, // every 1 minute
    method: 'GET',
  },
];

async function runJob(job: CronJob): Promise<void> {
  const url = `${BASE_URL}${job.path}`;
  const method = job.method || 'GET';
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Try Vercel-style cron auth first, then Bearer
    if (CRON_SECRET) {
      headers['authorization'] = `Bearer ${CRON_SECRET}`;
    }

    const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(30_000) });
    const body = await res.text();
    
    const timestamp = new Date().toISOString();
    if (res.ok) {
      console.log(`[${timestamp}] ✓ ${job.name} (${res.status})`);
    } else {
      console.error(`[${timestamp}] ✗ ${job.name} (${res.status}): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ✗ ${job.name}: ${(err as Error).message}`);
  }
}

function startJob(job: CronJob): void {
  console.log(`[cron-worker] Scheduling "${job.name}" every ${job.intervalMs / 1000}s → ${BASE_URL}${job.path}`);
  
  // Run immediately on startup
  runJob(job);
  
  // Then on interval
  setInterval(() => runJob(job), job.intervalMs);
}

// --- Main ---
console.log(`[cron-worker] Starting with BASE_URL=${BASE_URL}`);
console.log(`[cron-worker] ${jobs.length} job(s) configured`);

for (const job of jobs) {
  startJob(job);
}

// Keep alive
process.on('SIGTERM', () => {
  console.log('[cron-worker] SIGTERM received, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[cron-worker] SIGINT received, shutting down');
  process.exit(0);
});
