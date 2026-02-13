/**
 * CLI Payout Command Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

const CLI_PATH = join(import.meta.dirname, '..', 'bin', 'coinpay.js');

describe('CLI Payout Commands', () => {
  const env = {
    ...process.env,
    COINPAY_API_KEY: 'cp_test_key',
    COINPAY_BASE_URL: 'http://localhost:9999',
  };

  it('should show error for unknown payout subcommand', () => {
    try {
      execSync(`node ${CLI_PATH} payout unknown`, { env, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      expect(e.stderr || e.stdout).toMatch(/unknown|Unknown/i);
    }
  });

  it('should require --amount for payout create', () => {
    try {
      execSync(`node ${CLI_PATH} payout create`, { env, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      expect(e.stderr || e.stdout).toMatch(/amount/i);
    }
  });

  it('should require id for payout get', () => {
    try {
      execSync(`node ${CLI_PATH} payout get`, { env, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      expect(e.stderr || e.stdout).toMatch(/usage|id/i);
    }
  });
});
