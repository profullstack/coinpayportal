/**
 * CLI Payout Command Tests
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { join } from 'path';

const CLI_PATH = join(import.meta.dirname, '..', 'bin', 'coinpay.js');
let hasNodeSpawn = false;

try {
  execFileSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'pipe' });
  hasNodeSpawn = true;
} catch {
  hasNodeSpawn = false;
}

describe.skipIf(!hasNodeSpawn)('CLI Payout Commands', () => {
  const env = {
    ...process.env,
    COINPAY_API_KEY: 'cp_test_key',
    COINPAY_BASE_URL: 'http://localhost:9999',
  };

  function runCLI(args) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      status: result.status ?? 1,
      output: `${result.stdout || ''}${result.stderr || ''}`,
    };
  }

  it('should show error for unknown payout subcommand', () => {
    const { output } = runCLI(['payout', 'unknown']);

    expect(output).toMatch(/unknown/i);
  });

  it('should require --amount for payout create', () => {
    const { output } = runCLI(['payout', 'create']);

    expect(output).toMatch(/amount/i);
  });

  it.each(['5000abc', '12.5', '1e3', '9007199254740992'])(
    'should reject invalid payout amount %s',
    (amount) => {
      const { status, output } = runCLI(['payout', 'create', '--amount', amount]);

      expect(status).not.toBe(0);
      expect(output).toMatch(/positive integer.*cents/i);
    }
  );

  it('should require id for payout get', () => {
    const { output } = runCLI(['payout', 'get']);

    expect(output).toMatch(/usage|id/i);
  });
});
