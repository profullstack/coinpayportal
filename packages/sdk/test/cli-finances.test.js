/**
 * CLI Finances Command Tests — argument handling only; no network.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI_PATH = join(import.meta.dirname, '..', 'bin', 'coinpay.js');
let hasNodeSpawn = false;

try {
  execFileSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'pipe' });
  hasNodeSpawn = true;
} catch {
  hasNodeSpawn = false;
}

describe.skipIf(!hasNodeSpawn)('CLI finances command', () => {
  // An isolated home so the tests never read the developer's real session.
  const home = mkdtempSync(join(tmpdir(), 'coinpay-finances-'));
  const env = {
    ...process.env,
    COINPAY_HOME: home,
    COINPAY_BASE_URL: 'http://127.0.0.1:9',
    COINPAY_API_KEY: '',
    COINPAY_SESSION_TOKEN: '',
  };

  function runCLI(args, extraEnv = {}) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
    return { status: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` };
  }

  it('lists finances in help', () => {
    const { output } = runCLI(['--help']);
    expect(output).toContain('finances');
    expect(output).toContain('Live dashboard');
    expect(output).toContain('connections');
  });

  it('refuses to run without a merchant session', () => {
    const { status, output } = runCLI(['finances', 'summary']);
    expect(status).toBe(1);
    expect(output).toContain('coinpay login');
  });

  it('does not accept a business API key for bank data', () => {
    const { status, output } = runCLI(['finances', 'accounts'], { COINPAY_API_KEY: 'cp_test_key' });
    expect(status).toBe(1);
    expect(output).toContain('merchant session');
  });

  it('rejects unknown subcommands', () => {
    writeFileSync(join(home, '.coinpay.json'), JSON.stringify({ jwtToken: 'x.y.z' }));
    const { status, output } = runCLI(['finances', 'bogus']);
    expect(status).toBe(1);
    expect(output).toContain('Unknown finances command');
    expect(output).toContain('summary|accounts|ledger|connections|sync');
  });

  it('accepts money as an alias and tui as the dashboard itself', () => {
    const { output } = runCLI(['money', 'bogus']);
    expect(output).toContain('Unknown finances command');
    // `coinpay tui` is the dashboard, so it goes straight to loading data.
    const tui = runCLI(['tui']);
    expect(tui.output).toContain('Could not load finances');
  });

  it('reports a network failure plainly for the plain-text summary', () => {
    // Non-TTY stdout → text mode; base URL points at a closed port.
    const { status, output } = runCLI(['finances']);
    expect(status).toBe(1);
    expect(output).toMatch(/Error:/);
    expect(output).not.toContain('TypeError');
  });
});
