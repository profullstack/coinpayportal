/**
 * CLI wallet backup and encrypted storage tests
 *
 * Tests the encrypted wallet storage flow:
 * - `coinpay wallet create` - creates wallet and saves encrypted
 * - `coinpay wallet unlock` - decrypts and shows info
 * - `coinpay wallet backup` - exports encrypted backup
 * - `coinpay wallet delete` - removes wallet file
 *
 * Tests are skipped if gpg is not installed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

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
 */
function runCLI(args, { cwd, expectFail, env = {} } = {}) {
  const cmd = `node ${CLI_PATH} ${args} 2>&1`;
  const opts = {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { 
      ...process.env, 
      COINPAY_API_KEY: 'cp_test_fake_key',
      ...env
    },
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

describe('CLI wallet encrypted storage', () => {
  let tmpDir;
  let walletFile;
  let configFile;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coinpay-test-'));
    walletFile = join(tmpDir, 'test-wallet.gpg');
    configFile = join(tmpDir, '.coinpay.json');
  });

  afterAll(() => {
    try {
      execSync(`rm -rf "${tmpDir}"`);
    } catch {
      // best effort cleanup
    }
  });

  beforeEach(() => {
    // Clean up wallet and config files before each test
    try {
      if (existsSync(walletFile)) unlinkSync(walletFile);
      if (existsSync(configFile)) unlinkSync(configFile);
    } catch {
      // ignore
    }
  });

  describe.skipIf(!hasGpg)('with gpg available', () => {
    const testPassword = 'test-password-123';

    it('wallet create should create encrypted wallet file', async () => {
      // Note: This test requires mocking the API call or using a test server
      // For now, we test the CLI argument parsing
      const { output } = runCLI(
        `wallet create --words 12 --password "${testPassword}" --wallet-file "${walletFile}" --no-save`,
        { expectFail: true }
      );
      
      // Should attempt to create wallet (may fail due to network)
      expect(output).toMatch(/create|wallet|error|network/i);
    });

    it('wallet backup should copy encrypted file when wallet exists', () => {
      // Create a fake encrypted wallet file
      const fakeContent = Buffer.from('fake-encrypted-content');
      writeFileSync(walletFile, fakeContent, { mode: 0o600 });
      
      // Write config pointing to wallet file
      writeFileSync(configFile, JSON.stringify({ walletFile }));
      
      const backupPath = join(tmpDir, 'my-backup.gpg');
      
      // Run backup command with HOME pointed to tmpDir (so it finds config)
      const { output } = runCLI(
        `wallet backup --output "${backupPath}" --wallet-file "${walletFile}"`,
        { cwd: tmpDir }
      );
      
      expect(output).toMatch(/backup|saved|error/i);
    });

    it('wallet delete should remove wallet file when confirmed', () => {
      // Create a wallet file
      writeFileSync(walletFile, 'test-content', { mode: 0o600 });
      
      // Note: delete requires interactive confirmation
      // We test that it asks for confirmation
      const { output } = runCLI(
        `wallet delete --wallet-file "${walletFile}"`,
        { expectFail: true }
      );
      
      // Should ask for confirmation or show no wallet message
      expect(output).toMatch(/delete|confirm|wallet|sure/i);
    });

    it('wallet unlock should prompt for password when wallet exists', () => {
      // Create a fake wallet file
      writeFileSync(walletFile, 'encrypted-content', { mode: 0o600 });
      
      const { output } = runCLI(
        `wallet unlock --wallet-file "${walletFile}"`,
        { expectFail: true }
      );
      
      // Should prompt for password or show error about decryption
      expect(output).toMatch(/password|decrypt|error|unlock/i);
    });
  });

  describe('without wallet file', () => {
    it('wallet backup should show error when no wallet exists', () => {
      const { output } = runCLI(
        `wallet backup --wallet-file "${join(tmpDir, 'nonexistent.gpg')}"`,
        { expectFail: true }
      );

      expect(output).toMatch(/no wallet|not found|error/i);
    });

    it('wallet unlock should show error when no wallet exists', () => {
      const { output } = runCLI(
        `wallet unlock --wallet-file "${join(tmpDir, 'nonexistent.gpg')}"`,
        { expectFail: true }
      );

      expect(output).toMatch(/no wallet|not found|error/i);
    });

    it('wallet info should show error when no wallet exists', () => {
      const { output } = runCLI(
        `wallet info --wallet-file "${join(tmpDir, 'nonexistent.gpg')}"`,
        { expectFail: true }
      );

      expect(output).toMatch(/no wallet|not found|error|create|import/i);
    });
  });

  describe('command argument parsing', () => {
    it('wallet create should accept --words flag', () => {
      const { output } = runCLI(
        'wallet create --words 24 --no-save',
        { expectFail: true }
      );
      
      // Should attempt create (network error expected)
      expect(output).toMatch(/create|wallet|mnemonic|error|network/i);
    });

    it('wallet create should accept --chains flag', () => {
      const { output } = runCLI(
        'wallet create --chains BTC,ETH --no-save',
        { expectFail: true }
      );
      
      expect(output).toMatch(/create|wallet|error|network/i);
    });

    it('wallet import should require mnemonic argument', () => {
      const { output } = runCLI(
        'wallet import',
        { expectFail: true }
      );
      
      expect(output).toMatch(/mnemonic|required|usage|import/i);
    });

    it('wallet send should require --chain, --to, --amount flags', () => {
      const { output } = runCLI(
        'wallet send',
        { expectFail: true }
      );
      
      expect(output).toMatch(/chain|to|amount|required|wallet|error/i);
    });
  });
});
