import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUsdFxRate, clearFxCache } from './fx';

global.fetch = vi.fn();

function mockFrankfurter(rates: Record<string, number>) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ amount: 1, base: 'USD', date: '2026-07-24', rates }),
  } as Response);
}

function mockErApi(rates: Record<string, number>) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ result: 'success', base_code: 'USD', rates }),
  } as Response);
}

describe('getUsdFxRate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFxCache();
  });

  it('returns 1 for USD without hitting the network', async () => {
    expect(await getUsdFxRate('USD')).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches ECB rates from Frankfurter', async () => {
    mockFrankfurter({ EUR: 0.879, GBP: 0.75 });
    expect(await getUsdFxRate('EUR')).toBe(0.879);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('frankfurter'),
      expect.any(Object)
    );
  });

  it('is case-insensitive', async () => {
    mockFrankfurter({ EUR: 0.879 });
    expect(await getUsdFxRate('eur')).toBe(0.879);
  });

  it('caches the whole snapshot — one fetch serves every currency', async () => {
    mockFrankfurter({ EUR: 0.879, JPY: 163.82 });
    expect(await getUsdFxRate('EUR')).toBe(0.879);
    expect(await getUsdFxRate('JPY')).toBe(163.82);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the secondary provider when Frankfurter fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503, statusText: 'x' } as Response);
    mockErApi({ EUR: 0.88 });

    expect(await getUsdFxRate('EUR')).toBe(0.88);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws when both providers fail and nothing is cached', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await expect(getUsdFxRate('EUR')).rejects.toThrow(/Failed to fetch USD\/EUR/);
  });

  it('throws for a currency the providers do not quote', async () => {
    // Never invent a rate: a missing currency must fail loudly, not default to 1.
    mockFrankfurter({ EUR: 0.879 });
    await expect(getUsdFxRate('XYZ')).rejects.toThrow(/No USD\/XYZ FX rate/);
  });

  it('rejects a zero or negative quote', async () => {
    mockFrankfurter({ EUR: 0 });
    await expect(getUsdFxRate('EUR')).rejects.toThrow(/No USD\/EUR FX rate/);
  });
});
