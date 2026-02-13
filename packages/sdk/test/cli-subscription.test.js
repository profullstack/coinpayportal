/**
 * CLI Subscription Commands Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

const CLI_PATH = resolve(import.meta.dirname, '../../../bin/coinpay');

describe('CLI Subscription Commands', () => {
  describe('help output', () => {
    it('should show subscription in help', () => {
      const output = execSync(`node ${CLI_PATH} help`, { encoding: 'utf-8' });
      expect(output).toContain('subscription');
      expect(output).toContain('create-plan');
      expect(output).toContain('subscribe');
      expect(output).toContain('cancel');
    });
  });

  describe('subscription create-plan', () => {
    it('should error without required flags', () => {
      try {
        execSync(`node ${CLI_PATH} subscription create-plan`, {
          encoding: 'utf-8',
          env: { ...process.env, COINPAY_API_KEY: 'test_key' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.stderr || err.stdout).toContain('--business');
      }
    });
  });

  describe('subscription subscribe', () => {
    it('should error without required flags', () => {
      try {
        execSync(`node ${CLI_PATH} subscription subscribe`, {
          encoding: 'utf-8',
          env: { ...process.env, COINPAY_API_KEY: 'test_key' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.stderr || err.stdout).toContain('--plan');
      }
    });
  });

  describe('subscription cancel', () => {
    it('should error without subscription ID', () => {
      try {
        execSync(`node ${CLI_PATH} subscription cancel`, {
          encoding: 'utf-8',
          env: { ...process.env, COINPAY_API_KEY: 'test_key' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.stderr || err.stdout).toContain('subscription ID required');
      }
    });
  });

  describe('subscription unknown subcommand', () => {
    it('should error on unknown subcommand', () => {
      try {
        execSync(`node ${CLI_PATH} subscription foobar`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.stderr || err.stdout).toContain('Unknown subscription command');
      }
    });
  });
});
