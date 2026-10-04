import { describe, it, expect, vi, afterEach } from 'vitest';
import { countExplorerRefusal, resetExplorerWatch, watchExplorer } from './explorer-watch';

const req = (ip: string | null) =>
  new Request('https://coinpayportal.com/explorer/sol/tx/abc', {
    headers: ip ? { 'x-real-ip': ip } : {},
  });

/** Force the 60s window to roll over so the summary is emitted. */
async function summaryAfter(fn: () => void): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    resetExplorerWatch();
    // One request opens the window, then the work, then time moves past it and
    // the next request flushes.
    watchExplorer(req('198.51.100.1'));
    fn();
    vi.advanceTimersByTime(61_000);
    watchExplorer(req('198.51.100.1'));
    return log.mock.calls.map((c) => String(c[0])).join('\n');
  } finally {
    vi.useRealTimers();
    log.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe('the explorer watcher', () => {
  it('reports addresses and the /24s they sit in', async () => {
    const out = await summaryAfter(() => {
      // A cloud fleet: many addresses, two subnets.
      for (let i = 2; i < 12; i++) watchExplorer(req(`203.0.113.${i}`));
      for (let i = 2; i < 6; i++) watchExplorer(req(`198.51.100.${i}`));
    });
    // 10 + 4 + the address that opened the window.
    expect(out).toMatch(/15 req\/min from 15 addresses in 2 \/24s/);
  });

  it('separates a proxy pool from a fleet', async () => {
    const out = await summaryAfter(() => {
      // A hundred addresses in a hundred subnets: bucketing by /24 buys nothing.
      for (let i = 0; i < 20; i++) watchExplorer(req(`10.${i}.0.1`));
    });
    expect(out).toMatch(/in 21 \/24s/);
  });

  it('says which tier is doing the refusing, or that none is', async () => {
    const quiet = await summaryAfter(() => {});
    expect(quiet).toMatch(/refused: none/);

    const busy = await summaryAfter(() => {
      countExplorerRefusal('burst');
      countExplorerRefusal('burst');
      countExplorerRefusal('daily');
    });
    expect(busy).toMatch(/burst=2/);
    expect(busy).toMatch(/daily=1/);
  });

  it('counts a request the edge gave no address for, rather than dropping it', async () => {
    const out = await summaryAfter(() => {
      watchExplorer(req(null));
      watchExplorer(req(null));
    });
    expect(out).toMatch(/2 unidentified/);
  });

  it('never throws, whatever it is handed', () => {
    expect(() => watchExplorer({} as Request)).not.toThrow();
    expect(() => countExplorerRefusal('burst')).not.toThrow();
  });
});
