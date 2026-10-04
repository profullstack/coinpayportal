// @vitest-environment jsdom
/**
 * The approval window's hold on the service worker.
 *
 * MV3 stops an idle worker after ~30s, and the worker is what holds the
 * request this window is deciding — a batch of 113 payments takes longer than
 * that to read, let alone to run. Without a ping the user types a password,
 * clicks Approve, and nothing happens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface FakePort {
  name: string;
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onDisconnect: { addListener: (fn: () => void) => void };
  drop: () => void;
}

function stubChrome() {
  const ports: FakePort[] = [];
  const connect = vi.fn((info: { name: string }) => {
    let onDisconnect = (): void => {};
    const port: FakePort = {
      name: info.name,
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onDisconnect: { addListener: (fn) => (onDisconnect = fn) },
      drop: () => onDisconnect(),
    };
    ports.push(port);
    return port;
  });
  vi.stubGlobal('chrome', {
    runtime: { connect, onMessage: { addListener: vi.fn() } },
  });
  return { connect, ports };
}

async function loadKeepAlive() {
  vi.resetModules();
  const mod = await import('../app.js');
  return mod.keepWorkerAwake;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('keepWorkerAwake', () => {
  it('holds a named port open and pings inside the idle timeout', async () => {
    const { connect, ports } = stubChrome();
    const stop = (await loadKeepAlive())();

    expect(connect).toHaveBeenCalledWith({ name: 'coinpay-keepalive' });
    // Two pings before the worker's ~30s idle timer could ever expire.
    vi.advanceTimersByTime(31_000);
    expect(ports[0]!.postMessage.mock.calls.length).toBeGreaterThanOrEqual(2);

    stop();
  });

  it('reconnects if the port drops, rather than pinging a dead one', async () => {
    const { connect, ports } = stubChrome();
    const stop = (await loadKeepAlive())();

    ports[0]!.drop();
    vi.advanceTimersByTime(15_000);

    expect(connect).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(15_000);
    expect(ports[1]!.postMessage).toHaveBeenCalled();

    stop();
  });

  it('stops pinging once the window goes away', async () => {
    const { ports } = stubChrome();
    (await loadKeepAlive())();

    window.dispatchEvent(new Event('pagehide'));
    const sent = ports[0]!.postMessage.mock.calls.length;
    vi.advanceTimersByTime(60_000);

    expect(ports[0]!.disconnect).toHaveBeenCalled();
    expect(ports[0]!.postMessage.mock.calls.length).toBe(sent);
  });
});
