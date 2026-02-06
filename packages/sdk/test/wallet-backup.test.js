/**
 * CLI wallet backup/decrypt tests
 *
 * These tests exercise the `coinpay wallet backup-seed` and
 * `coinpay wallet decrypt-backup` CLI commands using system gpg.
 * Tests are skipped if gpg is not installed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const CLI_PATH = join(import.meta.dirname, '..', 'bin', 'coinpay.js');

// Check if gpg is available
let hasGpg = false;
try {
  execSync('gpg --version', { stdio: 'pipe' });
  hasGpg = true;
} catch {
  hasGpg = false;
}

/**
 * Run the CLI and capture merged stdout+stderr.
 * We merge via shell redirection since the CLI uses both console.log and console.error.
 * Returns { output, status }.
 */
function runCLI(args, { cwd, expectFail } = {}) {
  const cmd = `node ${CLI_PATH} ${args} 2>&1`;
  const opts = {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, COINPAY_API_KEY: 'cp_test_fake_key' },
    timeout: 30000,
    ...(cwd ? { cwd } : {}),
  };

  try {
    const output = execSync(cmd, opts);
    return { output, status: 0 };
  } catch (err) {
    if (expectFail) {
      return {
        output: (err.stdout || '') + (err.stderr || ''),
        status: err.status || 1,
      };
    }
    throw err;
  }
}

describe('CLI wallet backup commands', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coinpay-test-'));
  });

  afterAll(() => {
    try {
      execSync(`rm -rf "${tmpDir}"`);
    } catch {
      // best effort
    }
  });

  describe.skipIf(!hasGpg)('with gpg available', () => {
    const testSeed =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const testPassword = 'test-password-123';
    const testWalletId = 'wid-test-001';

    it('backup-seed should create a .gpg file', () => {
      const outputPath = join(tmpDir, `wallet_${testWalletId}_seedphrase.txt.gpg`);

      runCLI(
        `wallet backup-seed --seed "${testSeed}" --password "${testPassword}" --wallet-id "${testWalletId}" --output "${outputPath}"`
      );

      expect(existsSync(outputPath)).toBe(true);
    });

    it('decrypt-backup should recover the seed phrase', () => {
      const outputPath = join(tmpDir, 'decrypt-roundtrip.txt.gpg');

      runCLI(
        `wallet backup-seed --seed "${testSeed}" --password "${testPassword}" --wallet-id "${testWalletId}" --output "${outputPath}"`
      );

      const { output } = runCLI(
        `wallet decrypt-backup "${outputPath}" --password "${testPassword}" --json`
      );

      const parsed = JSON.parse(output);
      expect(parsed.mnemonic).toBe(testSeed);
    });

    it('decrypt-backup with wrong password should show error message', () => {
      const outputPath = join(tmpDir, 'wrong-pw-test.txt.gpg');

      runCLI(
        `wallet backup-seed --seed "${testSeed}" --password "${testPassword}" --wallet-id "${testWalletId}" --output "${outputPath}"`
      );

      // The CLI catches gpg errors and prints a user-friendly message
      // It may or may not exit non-zero depending on implementation
      const { output } = runCLI(
        `wallet decrypt-backup "${outputPath}" --password "wrong-password"`,
        { expectFail: true }
      );

      expect(output).toMatch(/failed|error|wrong/i);
    });

    it('backup-seed should use default filename when --output is not provided', () => {
      const cmd = `wallet backup-seed --seed "${testSeed}" --password "${testPassword}" --wallet-id "default-name"`;
      runCLI(cmd, { cwd: tmpDir });

      const expectedFile = join(tmpDir, 'wallet_default-name_seedphrase.txt.gpg');
      expect(existsSync(expectedFile)).toBe(true);
    });

    it('decrypt-backup should include wallet ID in raw output', () => {
      const outputPath = join(tmpDir, 'walletid-check.txt.gpg');

      runCLI(
        `wallet backup-seed --seed "${testSeed}" --password "${testPassword}" --wallet-id "${testWalletId}" --output "${outputPath}"`
      );

      const { output } = runCLI(
        `wallet decrypt-backup "${outputPath}" --password "${testPassword}" --json`
      );

      const parsed = JSON.parse(output);
      expect(parsed.raw).toContain(`Wallet ID: ${testWalletId}`);
    });
  });

  describe('missing required flags', () => {
    it('backup-seed without --wallet-id should show error', () => {
      const { output } = runCLI(
        'wallet backup-seed --seed "test words" --password "pass"',
        { expectFail: true }
      );

      // The CLI prints "Required: --wallet-id <id>" via console.error
      expect(output).toMatch(/wallet-id/i);
    });

    it('decrypt-backup without file path should show error or usage info', () => {
      const { output } = runCLI(
        'wallet decrypt-backup --password "pass"',
        { expectFail: true }
      );

      // The CLI prints "Backup file path required" + example
      expect(output).toMatch(/file|path|backup|required|example/i);
    });

    it('decrypt-backup with nonexistent file should show error', () => {
      const { output } = runCLI(
        'wallet decrypt-backup /tmp/nonexistent-file-12345.gpg --password "pass"',
        { expectFail: true }
      );

      expect(output).toMatch(/not found|error/i);
    });
  });
});
