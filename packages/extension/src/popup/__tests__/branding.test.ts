// @vitest-environment jsdom
/**
 * Logo and the version footer.
 *
 * The footer exists so anyone — user or us — can tell at a glance which build a
 * browser is actually running. That only works if it reads the live manifest
 * rather than a constant someone forgets to bump, so that is what these pin.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { renderFooter, installedVersion } from '../app.js';
import { logo, brand } from '../dom.js';

function stubManifest(version: string) {
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version }) } });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><footer id="footer"></footer>';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('version footer', () => {
  it('shows the version the browser actually has installed', () => {
    stubManifest('0.4.1');
    renderFooter();

    expect(document.getElementById('footer')!.textContent).toBe('CoinPay Wallet v0.4.1');
  });

  it('tracks the manifest rather than a hardcoded string', () => {
    stubManifest('9.9.9');
    renderFooter();

    expect(document.getElementById('footer')!.textContent).toContain('9.9.9');
  });

  it('degrades to the name when no manifest is reachable', () => {
    // Non-extension contexts (and our own tests) have no chrome.runtime.
    vi.stubGlobal('chrome', undefined);
    renderFooter();

    expect(installedVersion()).toBe('');
    expect(document.getElementById('footer')!.textContent).toBe('CoinPay Wallet');
  });

  it('does not throw when the footer element is missing', () => {
    stubManifest('0.4.1');
    document.body.innerHTML = '<div id="app"></div>';

    expect(() => renderFooter()).not.toThrow();
  });
});

describe('logo', () => {
  it('points at a packaged icon, not a remote URL', () => {
    // MV3 blocks remote images in the popup, and a wallet must not phone home
    // for its own branding.
    const img = logo();

    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('../icons/icon-128.png');
    expect(img.getAttribute('src')).not.toMatch(/^https?:/);
  });

  it('is decorative, so screen readers skip it', () => {
    expect(logo().getAttribute('alt')).toBe('');
  });

  it('scales without redrawing at a second source', () => {
    // The topbar uses a smaller mark; same asset, different box.
    expect(logo(20).getAttribute('width')).toBe('20');
    expect(logo(20).getAttribute('src')).toBe(logo(24).getAttribute('src'));
  });
});

describe('brand heading', () => {
  it('pairs the logo with the screen title', () => {
    const heading = brand('Confirm bulk payment');

    expect(heading.querySelector('img.logo')).not.toBeNull();
    expect(heading.querySelector('h1')!.textContent).toBe('Confirm bulk payment');
  });
});
