/**
 * CLI Reputation Command Tests
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../bin/coinpay.js');

function run(args) {
  try {
    return execSync(`node ${CLI} ${args} 2>&1`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, COINPAY_API_KEY: 'test-key-123' },
    });
  } catch (error) {
    return (error.stdout || '') + (error.stderr || '');
  }
}

describe('CLI Reputation Commands', () => {
  it('should show reputation in help output', () => {
    const output = run('--help');
    expect(output).toContain('reputation');
    expect(output).toContain('submit');
    expect(output).toContain('query');
    expect(output).toContain('credential');
    expect(output).toContain('verify');
    expect(output).toContain('revocations');
  });

  it('reputation submit should require --receipt flag', () => {
    const output = run('reputation submit');
    expect(output).toContain('--receipt');
  });

  it('reputation query should require agent DID', () => {
    const output = run('reputation query');
    expect(output).toContain('Agent DID required');
  });

  it('reputation credential should require credential ID', () => {
    const output = run('reputation credential');
    expect(output).toContain('Credential ID required');
  });

  it('reputation verify should require credential ID', () => {
    const output = run('reputation verify');
    expect(output).toContain('Credential ID required');
  });

  it('reputation unknown subcommand should show available commands', () => {
    const output = run('reputation unknown-cmd');
    expect(output).toContain('Unknown reputation command');
    expect(output).toContain('submit');
  });

  it('reputation submit with invalid JSON should error', () => {
    const output = run("reputation submit --receipt '{bad-json'");
    expect(output).toContain('Could not parse receipt JSON');
  });
});
