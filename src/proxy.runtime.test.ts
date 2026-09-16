import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
let fixture: string;
let server: ChildProcess;
let baseUrl: string;
let output = '';

// Run the repository's interception files through Next's actual discovery and
// HTTP pipeline. Only downstream routes are fixtures, so tests never call a
// blockchain provider or require payment/database credentials.
beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'coinpay-proxy-'));
  await symlink(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  await mkdir(join(fixture, 'src/lib'), { recursive: true });
  for (const dir of ['', 'src']) {
    for (const file of await readdir(join(root, dir))) {
      if (/^(middleware|proxy)\.[cm]?[jt]sx?$/.test(file)) {
        await cp(join(root, dir, file), join(fixture, dir, file));
      }
    }
  }
  for (const file of ['explorer-abuse.ts', 'explorer-identity.ts', 'explorer-budget.ts', 'crawl-gateway.ts', 'explorer-gateway.ts', 'explorer-watch.ts', 'throttle.ts']) {
    await cp(join(root, 'src/lib', file), join(fixture, 'src/lib', file));
  }
  await mkdir(join(fixture, 'src/lib/auth'), { recursive: true });
  await cp(join(root, 'src/lib/auth/jwt.ts'), join(fixture, 'src/lib/auth/jwt.ts'));
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await writeFile(join(fixture, 'next.config.mjs'), 'export default { agentRules: false };');
  await writeFile(join(fixture, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
  }));
  for (const route of ['api/health', 'explorer/[...path]']) {
    const dir = join(fixture, 'src/app', route);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'route.ts'), 'export function GET() { return Response.json({ downstream: true }); }');
  }

  server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: fixture,
    env: { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', COINPAY_X402_KEY: '', CRAWL_PAY_TO: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Next did not start:\n${output}`)), 45_000);
    server.once('error', (error) => { clearTimeout(timeout); reject(error); });
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Next exited (${code}):\n${output}`)); });
    const onData = (data: Buffer) => {
      output += data.toString();
      const address = /Local:\s+(http:\/\/[^\s]+)/.exec(output);
      if (address && output.includes('Ready in')) {
        baseUrl = address[1];
        clearTimeout(timeout);
        resolve();
      }
    };
    server.stdout!.on('data', onData);
    server.stderr!.on('data', onData);
  });
}, 60_000);

afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const forceKill = setTimeout(() => server.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(forceKill);
  }
  if (fixture) await rm(fixture, { recursive: true, force: true });
}, 15_000);

function get(path: string, ip: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers: { 'x-forwarded-for': ip, ...headers } });
}

describe('Next.js HTTP security entry point', () => {
  it('has one convention entry point beside src/app', async () => {
    const entries: string[] = [];
    for (const dir of ['', 'src']) {
      for (const file of await readdir(join(root, dir))) {
        if (/^(middleware|proxy)\.[cm]?[jt]sx?$/.test(file)) entries.push(join(dir, file));
      }
    }
    expect(entries).toEqual(['src/proxy.ts']);
  });

  it('runs security and referral tracking on real HTTP requests', async () => {
    const response = await get('/api/health?ref=runtime-partner', '198.51.100.20');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ downstream: true });
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toContain('referral_code=runtime-partner');
  }, 30_000);

  it('stops a training crawler before reaching the route', async () => {
    const response = await get('/api/health?ref=crawler', '198.51.100.21', { 'user-agent': 'GPTBot' });
    expect(response.status).toBe(402);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(await response.json()).toHaveProperty('x402Version');
  });

  it('enforces the site-wide allowance through HTTP', async () => {
    for (let i = 0; i < 100; i++) {
      const response = await get('/api/health', '198.51.100.23');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ downstream: true });
    }
    const response = await get('/api/health', '198.51.100.23');
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(await response.json()).toMatchObject({ error: 'Too many requests', limit: 100 });
  }, 30_000);

  it('allows 30 explorer requests, then refuses the 31st before rendering', async () => {
    for (let i = 0; i < 30; i++) {
      const response = await get(`/explorer/eth/tx/0x${i}`, '198.51.100.22');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ downstream: true });
    }
    const response = await get('/explorer/eth/tx/0x31?ref=scraper', '198.51.100.22');
    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('30');
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(await response.text()).toBe('Too many requests');
  }, 30_000);
});
