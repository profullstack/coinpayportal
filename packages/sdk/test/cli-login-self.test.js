/**
 * `coinpay auth login` is the same OAuth 2.1 / device sign-in as `coinpay
 * login` (the help has always advertised it there); only an explicit
 * --email/--password takes the deprecated password path. `coinpay self
 * update|remove` reach the installer like the top-level commands do.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = join(import.meta.dirname, '..', 'bin', 'coinpay.js');

function runCLI(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, COINPAY_API_KEY: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ status: code, output: stdout + stderr }));
  });
}

describe('coinpay auth login and coinpay self', () => {
  let server;
  let base;
  const hits = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        hits.push({ method: req.method, path: req.url, body });
        const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
        if (req.url === '/api/cli-auth/start') return json(200, { device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_uri: 'https://example.test/device', expires_in: 60, interval: 1 });
        if (req.url === '/api/cli-auth/poll') return json(200, { status: 'complete', token: 'session-token-from-device-flow' });
        if (req.url === '/api/auth/login') return json(200, { success: true, token: 'legacy-token', merchant: { id: 'm-1', email: 'someone@example.com' } });
        if (req.url === '/install.sh') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('echo "installer-ran:$1"\n'); }
        return json(404, { error: 'not found' });
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => server?.close());

  const homeWithConfig = () => {
    const home = mkdtempSync(join(tmpdir(), 'coinpay-cli-home-'));
    writeFileSync(join(home, '.coinpay.json'), JSON.stringify({ baseUrl: `${base}/api` }));
    return home;
  };

  it('auth login --device runs the device flow and saves the session', { timeout: 30_000 }, async () => {
    const home = homeWithConfig();
    const result = await runCLI(['auth', 'login', '--device'], { COINPAY_HOME: home, COINPAY_BASE_URL: `${base}/api` });
    expect(result.output).toContain('ABCD-EFGH');
    expect(result.output).not.toMatch(/Required: --email/);
    expect(hits.some((h) => h.path === '/api/cli-auth/start')).toBe(true);
    expect(JSON.parse(readFileSync(join(home, '.coinpay.json'), 'utf8')).jwtToken).toBe('session-token-from-device-flow');
  });

  it('auth login --email/--password keeps the old path, with a deprecation note', { timeout: 30_000 }, async () => {
    const home = homeWithConfig();
    const result = await runCLI(['auth', 'login', '--email', 'someone@example.com', '--password', 'not-a-real-password'], { COINPAY_HOME: home, COINPAY_BASE_URL: `${base}/api` });
    expect(result.output).toMatch(/deprecated/);
    expect(hits.some((h) => h.path === '/api/auth/login')).toBe(true);
  });

  it('self update and self remove call the installer; an unknown one exits 1', { timeout: 30_000 }, async () => {
    const env = { COINPAY_HOME: homeWithConfig(), COINPAY_INSTALL_URL: `${base}/install.sh` };
    expect((await runCLI(['self', 'update'], env)).output).toContain('installer-ran:update');
    expect((await runCLI(['self', 'upgrade'], env)).output).toContain('installer-ran:update');
    expect((await runCLI(['self', 'remove'], env)).output).toContain('installer-ran:remove');
    const bad = await runCLI(['self', 'explode'], env);
    expect(bad.status).toBe(1);
    expect(bad.output).toMatch(/Unknown self command/);
  });
});
