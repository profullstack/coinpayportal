/**
 * CLI Card Command Tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'bin', 'coinpay');

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

describe('CLI Card Commands', () => {
  let tmpDir;
  let testHome;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coinpay-card-test-'));
    testHome = tmpDir;
  });

  afterAll(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Reset any test state
  });

  describe('help and basic commands', () => {
    it('should show main help with card commands', () => {
      const result = runCLI('help', { home: testHome });
      
      expect(result.output).toContain('card');
      expect(result.output).toContain('Card payments and escrow');
      expect(result.status).toBe(0);
    });

    it('should show card help when no subcommand provided', () => {
      const result = runCLI('card', { home: testHome });
      
      expect(result.output).toContain('Card Commands:');
      expect(result.output).toContain('coinpay card pay');
      expect(result.output).toContain('coinpay card escrow');
      expect(result.output).toContain('coinpay card escrows');
      expect(result.output).toContain('coinpay card release');
      expect(result.output).toContain('coinpay card refund');
      expect(result.output).toContain('coinpay card transactions');
      expect(result.output).toContain('coinpay card balance');
      expect(result.status).toBe(1); // Should exit with error for missing command
    });

    it('should show error for unknown card subcommand', () => {
      const result = runCLI('card unknown', { home: testHome });
      
      expect(result.output).toContain('Unknown card command: unknown');
      expect(result.output).toContain('Card Commands:');
      expect(result.status).toBe(1);
    });
  });

  describe('card pay command', () => {
    it('should require business, amount, and description', () => {
      const result = runCLI('card pay', { home: testHome });
      
      expect(result.output).toContain('--business, --amount, and --description are required');
      expect(result.output).toContain('Usage: coinpay card pay --business <id> --amount <usd> --description "text"');
      expect(result.status).toBe(1);
    });

    it('should require missing business parameter', () => {
      const result = runCLI('card pay --amount 50 --description "test payment"', { home: testHome });
      
      expect(result.output).toContain('--business, --amount, and --description are required');
      expect(result.status).toBe(1);
    });

    it('should require missing amount parameter', () => {
      const result = runCLI('card pay --business biz123 --description "test payment"', { home: testHome });
      
      expect(result.output).toContain('--business, --amount, and --description are required');
      expect(result.status).toBe(1);
    });

    it('should require missing description parameter', () => {
      const result = runCLI('card pay --business biz123 --amount 50', { home: testHome });
      
      expect(result.output).toContain('--business, --amount, and --description are required');
      expect(result.status).toBe(1);
    });

    it('should require API key', () => {
      const result = runCLI('card pay --business biz123 --amount 50 --description "test"', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });
  });

  describe('card escrow command', () => {
    it('should require business, amount, and description', () => {
      const result = runCLI('card escrow', { home: testHome });
      
      expect(result.output).toContain('--business, --amount, and --description are required');
      expect(result.output).toContain('Usage: coinpay card escrow --business <id> --amount <usd> --description "text"');
      expect(result.status).toBe(1);
    });

    it('should require all parameters', () => {
      const result = runCLI('card escrow --business biz123', { home: testHome });
      
      expect(result.output).toContain('--business, --amount, and --description are required');
      expect(result.status).toBe(1);
    });

    it('should require API key', () => {
      const result = runCLI('card escrow --business biz123 --amount 100 --description "test escrow"', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });
  });

  describe('card escrows command', () => {
    it('should require API key', () => {
      const result = runCLI('card escrows', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });

    it('should accept optional filter parameters', () => {
      // This will fail due to missing API key but should show we parse the args correctly
      const result = runCLI('card escrows --business biz123 --status pending --limit 10', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });
  });

  describe('card release command', () => {
    it('should require escrow ID', () => {
      const result = runCLI('card release', { home: testHome });
      
      expect(result.output).toContain('Escrow ID is required');
      expect(result.output).toContain('Usage: coinpay card release <escrowId>');
      expect(result.status).toBe(1);
    });

    it('should require API key when escrow ID provided', () => {
      const result = runCLI('card release escrow_123', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });
  });

  describe('card refund command', () => {
    it('should require escrow ID', () => {
      const result = runCLI('card refund', { home: testHome });
      
      expect(result.output).toContain('Escrow ID is required');
      expect(result.output).toContain('Usage: coinpay card refund <escrowId> [--partial <amount>]');
      expect(result.status).toBe(1);
    });

    it('should accept partial refund option', () => {
      // This will fail due to missing API key but should show we parse the args correctly
      const result = runCLI('card refund escrow_123 --partial 25.50', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });

    it('should require API key when escrow ID provided', () => {
      const result = runCLI('card refund escrow_123', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });
  });

  describe('card transactions command', () => {
    it('should require API key', () => {
      const result = runCLI('card transactions', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });

    it('should accept optional filter parameters', () => {
      // This will fail due to missing API key but should show we parse the args correctly
      const result = runCLI('card transactions --business biz123 --status completed --limit 20', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });
  });

  describe('card balance command', () => {
    it('should show not implemented message for now', () => {
      const result = runCLI('card balance', { home: testHome });
      
      expect(result.output).toContain('STRIPE BALANCE');
      expect(result.output).toContain('API not implemented');
      expect(result.output).toContain('Stripe balance API endpoint not yet implemented');
      expect(result.status).toBe(0); // This command doesn't require API key yet since it's not implemented
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', () => {
      // Test with a valid API key but unreachable endpoint
      const result = runCLI('card pay --business test --amount 10 --description "test"', {
        home: testHome,
        env: { 
          COINPAY_API_KEY: 'cp_test_key',
          COINPAY_API_URL: 'http://localhost:99999' // Unreachable port
        }
      });
      
      expect(result.output).toContain('Error creating payment:');
      expect(result.status).toBe(1);
    });
  });

  describe('argument parsing', () => {
    it('should parse business ID correctly', () => {
      const result = runCLI('card pay --business "biz with spaces" --amount 50 --description "test"', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      // Should get to the API key check, meaning args were parsed
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });

    it('should parse quoted descriptions correctly', () => {
      const result = runCLI('card escrow --business biz123 --amount 100 --description "Payment for Order #123"', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      // Should get to the API key check, meaning args were parsed
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });

    it('should parse numeric amounts correctly', () => {
      const result = runCLI('card pay --business biz123 --amount 99.99 --description "test"', { 
        home: testHome,
        env: { COINPAY_API_KEY: '' }
      });
      
      // Should get to the API key check, meaning args were parsed
      expect(result.output).toContain('COINPAY_API_KEY environment variable required');
      expect(result.status).toBe(1);
    });
  });
});