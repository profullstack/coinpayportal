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

type Target = 'chrome' | 'firefox' | 'safari';

function manifest(target: Target): any {
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

describe.each(['chrome', 'firefox', 'safari'] as const)('%s manifest', (target) => {
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
  it('keeps every target on the same version', () => {
    const versions = (['chrome', 'firefox', 'safari'] as const).map((t) => manifest(t).version);
    expect(new Set(versions).size).toBe(1);
  });

  it('matches the version the package is released under', () => {
    const pkg = JSON.parse(read('package.json'));
    // A manifest left behind at the previous version ships an extension the
    // stores accept and then never update — the version is the update trigger.
    expect(manifest('chrome').version).toBe(pkg.version);
  });
});

describe('store packaging', () => {
  // `key` pins the extension id of the self-hosted build so an install from
  // tronbrowser.dev replaces the existing copy rather than sitting beside it.
  // The stores mint their own id, and shipping a foreign key to them is at
  // best ignored — `scripts/package.mjs` strips it for chrome/firefox/safari.
  it('keeps the pinned id on the build the self-hosted channel is cut from', () => {
    expect(typeof manifest('chrome').key).toBe('string');
  });

  it('does not pin an id on targets that never self-host', () => {
    expect(manifest('firefox').key).toBeUndefined();
    expect(manifest('safari').key).toBeUndefined();
  });

  it('gives firefox the identity and data disclosure AMO requires', () => {
    const gecko = manifest('firefox').browser_specific_settings?.gecko;
    expect(gecko?.id).toBe('coinpay@profullstack.com');
    // AMO refuses a listed submission with no data-collection declaration, and
    // the key itself is only understood from Firefox 140.
    expect(gecko?.data_collection_permissions?.required?.length).toBeGreaterThan(0);
    expect(Number.parseFloat(gecko.strict_min_version)).toBeGreaterThanOrEqual(140);
  });

  it('gives safari a background worker, not a Gecko event page', () => {
    // Safari follows the Chromium MV3 shape; `background.scripts` silently
    // never runs there.
    expect(manifest('safari').background.service_worker).toBe('background/index.js');
    expect(manifest('safari').browser_specific_settings?.safari?.strict_min_version).toBeTruthy();
  });

  it('describes itself to the stores with everything a listing needs', () => {
    const listing = JSON.parse(read('store-listing.json'));
    // Chrome rejects a publish with a detailed description under 25 chars, and
    // both stores require a reachable privacy policy for a wallet.
    expect(listing.description.length).toBeGreaterThan(25);
    expect(listing.privacyPolicyUrl).toMatch(/^https:\/\//);
    expect(listing.chrome.singlePurpose).toBeTruthy();
    expect(listing.firefox.privacyPolicyText).toBeTruthy();
    for (const permission of manifest('chrome').permissions) {
      expect(listing.chrome.permissionJustifications[permission]).toBeTruthy();
    }
  });
});
