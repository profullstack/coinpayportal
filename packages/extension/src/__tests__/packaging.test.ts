/**
 * Packaging invariants that a type-checker cannot catch but a browser will.
 *
 * These fail loudly at test time instead of as a silent "extension didn't load"
 * after install.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(path: string): string {
  return readFileSync(resolve(pkgRoot, path), 'utf8');
}

function manifest(target: 'chrome' | 'firefox'): any {
  return JSON.parse(read(`manifest/manifest.${target}.json`));
}

describe('content script', () => {
  it('has no imports — MV3 loads it as a classic script, not a module', () => {
    const source = read('src/content/bridge.ts');
    // A static import would bundle into a chunk that a classic script can't
    // load, and the provider would silently never be injected.
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

describe.each(['chrome', 'firefox'] as const)('%s manifest', (target) => {
  const m = manifest(target);

  it('declares the content script and its injected provider together', () => {
    const contentScript = m.content_scripts?.[0];
    expect(contentScript?.js).toContain('content/bridge.js');
    // document_start so `window.coinpay` exists before page scripts run.
    expect(contentScript.run_at).toBe('document_start');

    const war = m.web_accessible_resources?.[0];
    expect(war?.resources).toContain('inpage/provider.js');
  });

  it('can inject into every site it can reach, and no further', () => {
    const contentMatches: string[] = m.content_scripts[0].matches;
    const warMatches: string[] = m.web_accessible_resources[0].matches;
    // If a page can run the bridge but not fetch the provider, `window.coinpay`
    // never appears — these two lists must agree.
    expect([...warMatches].sort()).toEqual([...contentMatches].sort());

    // Host permissions must cover every injected origin, or `chrome.tabs
    // .sendMessage` progress relay is dropped for that tab.
    for (const match of contentMatches) {
      expect(m.host_permissions).toContain(match);
    }
  });

  it('can reach the CoinPay API for prepare-tx and broadcast', () => {
    expect(m.host_permissions).toContain('https://coinpayportal.com/*');
  });

  it('requests only the permissions the wallet actually uses', () => {
    expect(new Set(m.permissions)).toEqual(new Set(['storage', 'alarms']));
  });

  it('ships the approval page the payment flow opens', () => {
    expect(() => read('src/approval/index.html')).not.toThrow();
  });
});

describe('manifest parity', () => {
  it('keeps chrome and firefox on the same version', () => {
    expect(manifest('chrome').version).toBe(manifest('firefox').version);
  });
});
