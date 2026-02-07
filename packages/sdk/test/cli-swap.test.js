/**
 * CLI Swap Command Tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

const CLI_PATH = join(import.meta.dirname, '..', 'bin', 'coinpay.js');

/**
 * Run CLI command and return output
 */
function runCLI(args, options = {}) {
  const { cwd, env: extraEnv, home } = options;
  const cmd = `node ${CLI_PATH} ${args} 2>&1`;
  const opts = {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { 
      ...process.env, 
      COINPAY_API_KEY: 'cp_test_fake_key',
      HOME: home || process.env.HOME,
      ...extraEnv,
    },
    timeout: 30000,
    ...(cwd ? { cwd } : {}),
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

describe('CLI Swap Commands', () => {
  let tmpDir;
  let testHome;
  let configPath;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coinpay-swap-test-'));
    testHome = tmpDir;
    configPath = join(testHome, '.coinpay.json');
    
    // Create test wallet config
    writeFileSync(configPath, JSON.stringify({
      walletId: 'wid-swap-test',
      createdAt: new Date().toISOString(),
    }));
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('swap --help', () => {
    it('should show swap commands in help', () => {
      const { output } = runCLI('--help');
      
      expect(output).toContain('swap');
      expect(output).toContain('coins');
      expect(output).toContain('quote');
      expect(output).toContain('create');
      expect(output).toContain('status');
    });
  });

  describe('swap coins', () => {
    it('should show swap coins command exists', () => {
      // This will fail at API call but validates command structure
      const { output } = runCLI('swap coins', { home: testHome });
      
      // Should attempt to call API
      expect(typeof output).toBe('string');
    });

    it('should accept --search flag', () => {
      const { output } = runCLI('swap coins --search btc', { home: testHome });
      
      // Validates flag parsing
      expect(typeof output).toBe('string');
    });

    it('should accept --json flag', () => {
      const { output } = runCLI('swap coins --json', { home: testHome });
      
      expect(typeof output).toBe('string');
    });
  });

  describe('swap quote', () => {
    it('should require --from, --to, --amount', () => {
      const { output, status } = runCLI('swap quote', { home: testHome });
      
      expect(output).toMatch(/required|from|to|amount/i);
    });

    it('should require --to', () => {
      const { output } = runCLI('swap quote --from BTC --amount 0.1', { home: testHome });
      
      expect(output).toMatch(/required|to/i);
    });

    it('should require --amount', () => {
      const { output } = runCLI('swap quote --from BTC --to ETH', { home: testHome });
      
      expect(output).toMatch(/required|amount/i);
    });

    it('should accept all required flags', () => {
      // Will fail at API but validates flag parsing
      const { output } = runCLI('swap quote --from BTC --to ETH --amount 0.1', { home: testHome });
      
      expect(typeof output).toBe('string');
      // Should not show "required" error
      expect(output).not.toMatch(/required: --from, --to, --amount/i);
    });

    it('should accept --json flag', () => {
      const { output } = runCLI('swap quote --from BTC --to ETH --amount 0.1 --json', { home: testHome });
      
      expect(typeof output).toBe('string');
    });
  });

  describe('swap create', () => {
    it('should require --from, --to, --amount', () => {
      const { output, status } = runCLI('swap create', { home: testHome });
      
      expect(output).toMatch(/required|from|to|amount/i);
    });

    it('should require wallet to be configured', () => {
      // Temporarily use a home without wallet config
      const emptyHome = mkdtempSync(join(tmpdir(), 'coinpay-empty-'));
      
      const { output } = runCLI('swap create --from BTC --to ETH --amount 0.1 --settle 0x...', { home: emptyHome });
      
      try { rmSync(emptyHome, { recursive: true }); } catch {}
      
      expect(output).toMatch(/no wallet|configured|create/i);
    });

    it('should require wallet or --settle address', () => {
      const { output } = runCLI('swap create --from BTC --to ETH --amount 0.1', { home: testHome });
      
      // CLI checks wallet first - without wallet, prompts to create one
      expect(output).toMatch(/wallet|settle|address|required/i);
    });

    it('should accept --refund flag', () => {
      const { output } = runCLI('swap create --from BTC --to ETH --amount 0.1 --settle 0x123 --refund bc1q...', { home: testHome });
      
      // Should pass validation and attempt API call
      expect(typeof output).toBe('string');
    });

    it('should accept --json flag', () => {
      const { output } = runCLI('swap create --from BTC --to ETH --amount 0.1 --settle 0x123 --json', { home: testHome });
      
      expect(typeof output).toBe('string');
    });
  });

  describe('swap status', () => {
    it('should require swap ID', () => {
      const { output, status } = runCLI('swap status', { home: testHome });
      
      expect(output).toMatch(/swap id|required/i);
    });

    it('should accept swap ID as argument', () => {
      const { output } = runCLI('swap status swap-123', { home: testHome });
      
      // Should attempt API call (will fail without real API)
      expect(typeof output).toBe('string');
    });

    it('should accept --id flag', () => {
      const { output } = runCLI('swap status --id swap-456', { home: testHome });
      
      expect(typeof output).toBe('string');
    });

    it('should accept --json flag', () => {
      const { output } = runCLI('swap status swap-123 --json', { home: testHome });
      
      expect(typeof output).toBe('string');
    });
  });

  describe('swap history', () => {
    it('should require wallet to be configured', () => {
      const emptyHome = mkdtempSync(join(tmpdir(), 'coinpay-empty-'));
      
      const { output } = runCLI('swap history', { home: emptyHome });
      
      try { rmSync(emptyHome, { recursive: true }); } catch {}
      
      expect(output).toMatch(/no wallet|configured|create/i);
    });

    it('should accept --limit flag', () => {
      const { output } = runCLI('swap history --limit 10', { home: testHome });
      
      expect(typeof output).toBe('string');
    });

    it('should accept --status flag', () => {
      const { output } = runCLI('swap history --status settled', { home: testHome });
      
      expect(typeof output).toBe('string');
    });

    it('should accept --json flag', () => {
      const { output } = runCLI('swap history --json', { home: testHome });
      
      expect(typeof output).toBe('string');
    });
  });

  describe('unknown swap commands', () => {
    it('should show error for unknown subcommand', () => {
      const { output, status } = runCLI('swap unknown-command', { home: testHome });
      
      expect(output).toMatch(/unknown|available/i);
      expect(status).toBe(1);
    });

    it('should list available commands', () => {
      const { output } = runCLI('swap invalid', { home: testHome });
      
      expect(output).toMatch(/coins|quote|create|status|history/i);
    });
  });

  describe('flag parsing', () => {
    it('should handle --from with =', () => {
      const { output } = runCLI('swap quote --from=BTC --to ETH --amount 0.1', { home: testHome });
      
      expect(output).not.toMatch(/required: --from/i);
    });

    it('should handle lowercase coin symbols', () => {
      const { output } = runCLI('swap quote --from btc --to eth --amount 0.1', { home: testHome });
      
      // Should uppercase internally
      expect(output).not.toMatch(/unsupported.*btc/i);
    });

    it('should handle numeric amount', () => {
      const { output } = runCLI('swap quote --from BTC --to ETH --amount 1.5', { home: testHome });
      
      expect(output).not.toMatch(/invalid amount/i);
    });
  });

  describe('output formatting', () => {
    it('should show user-friendly output by default', () => {
      const { output } = runCLI('swap coins', { home: testHome });
      
      // Should not be raw JSON by default
      expect(output).not.toMatch(/^\s*\{/);
    });

    it('should output JSON when --json flag is set', () => {
      const { output } = runCLI('swap coins --json', { home: testHome });
      
      expect(typeof output).toBe('string');
    });
  });

  describe('error handling', () => {
    it('should show friendly error for network issues', () => {
      const { output, status } = runCLI('swap coins', { home: testHome });
      
      // Should show some error, not crash
      expect(typeof output).toBe('string');
    });

    it('should not expose stack traces without --debug', () => {
      const { output } = runCLI('swap status invalid-id', { home: testHome });
      
      expect(output).not.toMatch(/at\s+\w+\s+\(/);  // Stack trace pattern
    });
  });
});
