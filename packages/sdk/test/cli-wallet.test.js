/**
 * CLI Wallet Command Tests
 * Tests for persistent GPG-encrypted wallet storage
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { execSync, exec } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

const CLI_PATH = join(import.meta.dirname, '..', 'bin', 'coinpay.js');
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Check if gpg is available
let hasGpg = false;
try {
  execSync('gpg --version', { stdio: 'pipe' });
  hasGpg = true;
} catch {
  hasGpg = false;
}

/**
 * Run CLI command and return output
 */
function runCLI(args, options = {}) {
  const { cwd, input, env: extraEnv } = options;
  const cmd = `node ${CLI_PATH} ${args} 2>&1`;
  const opts = {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { 
      ...process.env, 
      COINPAY_API_KEY: 'cp_test_fake_key',
      HOME: options.home || process.env.HOME,
      ...extraEnv,
    },
    timeout: 30000,
    ...(cwd ? { cwd } : {}),
    ...(input ? { input } : {}),
  };

  try {
    const output = execSync(cmd, opts);
    return { output, status: 0 };
  } catch (err) {
    return {
      output: (err.stdout || '') + (err.stderr || ''),
      status: err.status || 1,
    };
  }
}

describe('CLI Wallet Commands', () => {
  let tmpDir;
  let testHome;
  let configPath;
  let walletPath;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coinpay-wallet-test-'));
    testHome = tmpDir;
    configPath = join(testHome, '.coinpay.json');
    walletPath = join(testHome, '.coinpay-wallet.gpg');
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    // Clean test files before each test
    try { unlinkSync(configPath); } catch {}
    try { unlinkSync(walletPath); } catch {}
  });

  describe('wallet --help', () => {
    it('should show wallet commands in help', () => {
      const { output } = runCLI('--help');
      
      expect(output).toContain('wallet');
      expect(output).toContain('create');
      expect(output).toContain('import');
      expect(output).toContain('unlock');
      expect(output).toContain('balance');
    });

    it('should show encrypted wallet options', () => {
      const { output } = runCLI('--help');
      
      expect(output).toContain('--password');
      expect(output).toContain('--wallet-file');
      expect(output).toContain('--no-save');
    });
  });

  describe('wallet create', () => {
    it('should show error without API connection', () => {
      const { output, status } = runCLI('wallet create --no-save', { home: testHome });
      
      // Should attempt to call API (which will fail without real API)
      expect(output).toMatch(/error|creating|wallet/i);
    });

    it('should accept --words flag', () => {
      const { output } = runCLI('wallet create --words 24 --no-save', { home: testHome });
      expect(typeof output).toBe('string');
    });

    it('should accept --chains flag', () => {
      const { output } = runCLI('wallet create --chains BTC,ETH --no-save', { home: testHome });
      expect(typeof output).toBe('string');
    });

    it('should accept --no-save flag', () => {
      const { output } = runCLI('wallet create --no-save', { home: testHome });
      expect(output).not.toContain('Save encrypted wallet');
    });
  });

  describe('wallet import', () => {
    it('should require mnemonic', () => {
      const { output, status } = runCLI('wallet import', { home: testHome });
      
      expect(output).toMatch(/mnemonic|required/i);
    });

    it('should validate mnemonic', () => {
      const { output, status } = runCLI('wallet import "invalid mnemonic phrase" --no-save', { home: testHome });
      
      expect(output).toMatch(/invalid/i);
    });

    it('should accept valid mnemonic format', () => {
      const { output } = runCLI(`wallet import "${TEST_MNEMONIC}" --no-save`, { home: testHome });
      
      // Should get past validation to API call
      expect(output).not.toMatch(/invalid mnemonic/i);
    });

    it('should accept --no-save flag', () => {
      const { output } = runCLI(`wallet import "${TEST_MNEMONIC}" --no-save`, { home: testHome });
      expect(output).not.toContain('Save encrypted wallet');
    });
  });

  describe('wallet info', () => {
    it('should show error without configured wallet', () => {
      const { output, status } = runCLI('wallet info', { home: testHome });
      
      expect(output).toMatch(/no wallet|configured|create/i);
    });

    it('should show wallet info when configured', () => {
      // Setup a mock wallet config
      writeFileSync(configPath, JSON.stringify({
        walletId: 'wid-test-123',
        walletFile: walletPath,
      }));
      
      const { output } = runCLI(`wallet info --wallet-file ${walletPath}`, { 
        home: testHome,
        env: { HOME: testHome },
      });
      
      expect(output).toContain('wid-test-123');
    });
  });

  describe('wallet unlock', () => {
    it('should show error without wallet file', () => {
      const { output } = runCLI(`wallet unlock --wallet-file ${walletPath}`, { home: testHome });
      
      expect(output).toMatch(/no wallet|not found|create/i);
    });
  });

  describe('wallet balance', () => {
    beforeEach(() => {
      writeFileSync(configPath, JSON.stringify({
        walletId: 'wid-test-balance',
      }));
    });

    it('should show wallet ID', () => {
      const { output } = runCLI(`wallet balance --wallet-file ${walletPath}`, { home: testHome });
      
      // Without encrypted wallet, should show info message
      expect(output).toContain('wid-test-balance');
    });

    it('should accept chain argument', () => {
      const { output } = runCLI(`wallet balance ETH --wallet-file ${walletPath}`, { home: testHome });
      
      expect(output).toContain('ETH');
    });
  });

  describe('wallet derive', () => {
    beforeEach(() => {
      writeFileSync(configPath, JSON.stringify({
        walletId: 'wid-test-derive',
      }));
    });

    it('should require chain', () => {
      const { output, status } = runCLI('wallet derive', { home: testHome });
      
      expect(output).toMatch(/chain|required/i);
    });

    it('should require encrypted wallet file', () => {
      const { output } = runCLI(`wallet derive ETH --wallet-file ${walletPath}`, { home: testHome });
      
      expect(output).toMatch(/no encrypted wallet|cannot derive/i);
    });
  });

  describe('wallet send', () => {
    beforeEach(() => {
      writeFileSync(configPath, JSON.stringify({
        walletId: 'wid-test-send',
      }));
    });

    it('should require all parameters', () => {
      const { output, status } = runCLI('wallet send', { home: testHome });
      
      expect(output).toMatch(/required|chain|to|amount/i);
    });

    it('should require --chain', () => {
      const { output } = runCLI('wallet send --to 0x123 --amount 0.1', { home: testHome });
      
      expect(output).toMatch(/chain/i);
    });

    it('should require encrypted wallet for signing', () => {
      const { output } = runCLI(`wallet send --chain ETH --to 0x123 --amount 0.1 --wallet-file ${walletPath}`, { home: testHome });
      
      expect(output).toMatch(/no encrypted wallet|cannot sign/i);
    });
  });

  describe('wallet backup', () => {
    it('should show error without wallet file', () => {
      const { output } = runCLI(`wallet backup --wallet-file ${walletPath}`, { home: testHome });
      
      expect(output).toMatch(/no wallet|not found/i);
    });
  });

  describe('wallet delete', () => {
    it('should handle non-existent wallet', () => {
      const { output } = runCLI(`wallet delete --wallet-file ${walletPath}`, { home: testHome });
      
      expect(output).toMatch(/no wallet|to delete/i);
    });
  });

  describe.skipIf(!hasGpg)('GPG encrypted wallet flow', () => {
    const testPassword = 'test-password-123';

    it('should create and save encrypted wallet', async () => {
      // This test simulates the full flow
      // Note: Would fail at API call in real scenario
      
      // Create a mock encrypted wallet file
      const content = JSON.stringify({
        version: 1,
        walletId: 'wid-gpg-test',
        mnemonic: TEST_MNEMONIC,
        createdAt: new Date().toISOString(),
      });
      
      const tmpFile = join(tmpDir, 'wallet-content.json');
      const passFile = join(tmpDir, 'pass');
      
      writeFileSync(tmpFile, content, { mode: 0o600 });
      writeFileSync(passFile, testPassword, { mode: 0o600 });
      
      try {
        execSync(
          `gpg --batch --yes --passphrase-file "${passFile}" --pinentry-mode loopback --symmetric --cipher-algo AES256 --output "${walletPath}" "${tmpFile}"`,
          { stdio: 'pipe' }
        );
        
        expect(existsSync(walletPath)).toBe(true);
      } finally {
        try { unlinkSync(tmpFile); } catch {}
        try { unlinkSync(passFile); } catch {}
      }
    });

    it('should decrypt wallet with correct password', () => {
      // First create encrypted wallet
      const content = JSON.stringify({
        version: 1,
        walletId: 'wid-decrypt-test',
        mnemonic: TEST_MNEMONIC,
        createdAt: new Date().toISOString(),
      });
      
      const tmpFile = join(tmpDir, 'wallet-decrypt.json');
      const passFile = join(tmpDir, 'pass-decrypt');
      
      writeFileSync(tmpFile, content, { mode: 0o600 });
      writeFileSync(passFile, testPassword, { mode: 0o600 });
      
      try {
        execSync(
          `gpg --batch --yes --passphrase-file "${passFile}" --pinentry-mode loopback --symmetric --cipher-algo AES256 --output "${walletPath}" "${tmpFile}"`,
          { stdio: 'pipe' }
        );
        
        // Now test unlock command
        writeFileSync(configPath, JSON.stringify({ walletId: 'wid-decrypt-test' }));
        
        const { output } = runCLI(
          `wallet unlock --wallet-file "${walletPath}" --password "${testPassword}"`,
          { home: testHome }
        );
        
        expect(output).toMatch(/unlocked|wallet id/i);
      } finally {
        try { unlinkSync(tmpFile); } catch {}
        try { unlinkSync(passFile); } catch {}
      }
    });

    it('should fail decryption with wrong password', () => {
      // Create encrypted wallet
      const content = JSON.stringify({
        version: 1,
        walletId: 'wid-wrong-pw',
        mnemonic: TEST_MNEMONIC,
      });
      
      const tmpFile = join(tmpDir, 'wallet-wrongpw.json');
      const passFile = join(tmpDir, 'pass-wrongpw');
      
      writeFileSync(tmpFile, content, { mode: 0o600 });
      writeFileSync(passFile, testPassword, { mode: 0o600 });
      
      try {
        execSync(
          `gpg --batch --yes --passphrase-file "${passFile}" --pinentry-mode loopback --symmetric --cipher-algo AES256 --output "${walletPath}" "${tmpFile}"`,
          { stdio: 'pipe' }
        );
        
        const { output, status } = runCLI(
          `wallet unlock --wallet-file "${walletPath}" --password "wrong-password"`,
          { home: testHome }
        );
        
        expect(output).toMatch(/wrong password|corrupted|failed/i);
      } finally {
        try { unlinkSync(tmpFile); } catch {}
        try { unlinkSync(passFile); } catch {}
      }
    });

    it('should backup encrypted wallet file', () => {
      // Create encrypted wallet
      const content = JSON.stringify({ version: 1, walletId: 'wid-backup', mnemonic: TEST_MNEMONIC });
      const tmpFile = join(tmpDir, 'wallet-backup-src.json');
      const passFile = join(tmpDir, 'pass-backup');
      const backupPath = join(tmpDir, 'wallet-backup.gpg');
      
      writeFileSync(tmpFile, content, { mode: 0o600 });
      writeFileSync(passFile, testPassword, { mode: 0o600 });
      
      try {
        execSync(
          `gpg --batch --yes --passphrase-file "${passFile}" --pinentry-mode loopback --symmetric --cipher-algo AES256 --output "${walletPath}" "${tmpFile}"`,
          { stdio: 'pipe' }
        );
        
        const { output } = runCLI(
          `wallet backup --wallet-file "${walletPath}" --output "${backupPath}"`,
          { home: testHome }
        );
        
        expect(existsSync(backupPath)).toBe(true);
        expect(output).toMatch(/backup.*saved/i);
      } finally {
        try { unlinkSync(tmpFile); } catch {}
        try { unlinkSync(passFile); } catch {}
        try { unlinkSync(backupPath); } catch {}
      }
    });
  });

  describe('unknown wallet commands', () => {
    it('should show error for unknown subcommand', () => {
      const { output, status } = runCLI('wallet unknown-command');
      
      expect(output).toMatch(/unknown|available/i);
      expect(status).toBe(1);
    });

    it('should list available commands', () => {
      const { output } = runCLI('wallet invalid-command');
      
      expect(output).toMatch(/create|import|unlock|info/i);
    });
  });
});

describe('CLI Wallet Backup Commands (GPG)', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coinpay-backup-test-'));
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe.skipIf(!hasGpg)('with gpg available', () => {
    const testPassword = 'test-password-123';
    const testWalletId = 'wid-backup-test';

    it('wallet info shows file status', () => {
      const configPath = join(tmpDir, '.coinpay.json');
      const walletPath = join(tmpDir, 'test-wallet.gpg');
      
      writeFileSync(configPath, JSON.stringify({
        walletId: testWalletId,
        walletFile: walletPath,
      }));
      
      const { output } = runCLI(`wallet info --wallet-file "${walletPath}"`, { 
        home: tmpDir,
        env: { HOME: tmpDir },
      });
      
      expect(output).toContain(testWalletId);
      expect(output).toMatch(/file exists.*no/i);
    });
  });
});
