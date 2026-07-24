import { describe, it, expect, beforeEach } from 'vitest';

import { ConnectionStore, normalizeOrigin } from '../connections.js';
import { MemoryStorage } from '../storage.js';

describe('normalizeOrigin', () => {
  it('reduces a URL to scheme://host[:port]', () => {
    expect(normalizeOrigin('https://ugig.net/dashboard/invoices?tab=received')).toBe(
      'https://ugig.net',
    );
  });

  it('keeps scheme, host, and port distinct', () => {
    // A grant to the real site must never cover a look-alike on another scheme
    // or port.
    expect(normalizeOrigin('http://ugig.net')).not.toBe(normalizeOrigin('https://ugig.net'));
    expect(normalizeOrigin('https://ugig.net:8443')).not.toBe(normalizeOrigin('https://ugig.net'));
    expect(normalizeOrigin('https://evil.ugig.net')).not.toBe(normalizeOrigin('https://ugig.net'));
  });

  it('rejects non-web and malformed origins', () => {
    expect(normalizeOrigin('file:///etc/passwd')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });
});

describe('ConnectionStore', () => {
  let store: ConnectionStore;

  beforeEach(() => {
    store = new ConnectionStore(new MemoryStorage());
  });

  it('reports nothing connected initially', async () => {
    expect(await store.isConnected('https://ugig.net')).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('connects and recognizes an origin', async () => {
    await store.connect('https://ugig.net');

    expect(await store.isConnected('https://ugig.net')).toBe(true);
    expect(await store.isConnected('https://example.com')).toBe(false);
  });

  it('treats a null origin as never connected', async () => {
    await store.connect('https://ugig.net');
    expect(await store.isConnected(null)).toBe(false);
  });

  it('is idempotent and preserves the original connection time', async () => {
    const first = await store.connect('https://ugig.net');
    const second = await store.connect('https://ugig.net');

    expect(second.connectedAt).toBe(first.connectedAt);
    expect(await store.list()).toHaveLength(1);
  });

  it('forgets a disconnected origin', async () => {
    await store.connect('https://ugig.net');
    await store.disconnect('https://ugig.net');

    expect(await store.isConnected('https://ugig.net')).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('touch only updates an existing connection, never creates one', async () => {
    await store.touch('https://ugig.net');
    expect(await store.isConnected('https://ugig.net')).toBe(false);

    await store.connect('https://ugig.net');
    await store.touch('https://ugig.net');
    expect(await store.isConnected('https://ugig.net')).toBe(true);
  });

  it('keeps connections separate per origin', async () => {
    await store.connect('https://ugig.net');
    await store.connect('https://coinpayportal.com');
    await store.disconnect('https://ugig.net');

    expect(await store.isConnected('https://coinpayportal.com')).toBe(true);
    expect(await store.isConnected('https://ugig.net')).toBe(false);
  });

  it('survives a round-trip through storage', async () => {
    const storage = new MemoryStorage();
    await new ConnectionStore(storage).connect('https://ugig.net');

    // A fresh store over the same storage = a service-worker restart.
    expect(await new ConnectionStore(storage).isConnected('https://ugig.net')).toBe(true);
  });
});
