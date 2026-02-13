/**
 * CLI Issuer Command Tests
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

describe('CLI Issuer Commands', () => {
  it('should show issuer commands in help output', () => {
    const output = run('--help');
    expect(output).toContain('issuer register');
    expect(output).toContain('issuer list');
    expect(output).toContain('issuer rotate');
    expect(output).toContain('issuer deactivate');
  });

  it('issuer register should require --name and --domain', () => {
    const output = run('reputation issuer register');
    expect(output).toContain('--name');
    expect(output).toContain('--domain');
  });

  it('issuer rotate should require --id', () => {
    const output = run('reputation issuer rotate');
    expect(output).toContain('--id');
  });

  it('issuer deactivate should require --id', () => {
    const output = run('reputation issuer deactivate');
    expect(output).toContain('--id');
  });
});
