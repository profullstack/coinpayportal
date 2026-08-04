/**
 * @vitest-environment jsdom
 */

/**
 * Two behaviours matter for the hero counters: measured numbers render as
 * measured, and everything else renders nothing. "Everything else" now includes
 * the window before the fetch resolves and every way it can fail — the previous
 * server-rendered version failed closed correctly and still shipped a homepage
 * with no stats on it, so the fetch path deserves the same scrutiny.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { HeroStats, HeroStatsView } from './HeroStats';
import { SETTLEMENT_ASSET_COUNT } from '@/lib/wallets/supported-chains';

// The real production figures at the time of writing.
const STATS = { paymentsSettled: 544, activeBusinesses: 103, settledVolumeUsd: 11360.15 };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HeroStatsView', () => {
  it('renders the measured figures', () => {
    const html = renderToStaticMarkup(<HeroStatsView stats={STATS} />);

    expect(html).toContain('544');
    expect(html).toContain('103');
    expect(html).toContain('$11,360');
    expect(html).toContain(String(SETTLEMENT_ASSET_COUNT));
    expect(html).toContain('Payments Settled');
    expect(html).toContain('Settled Volume');
  });

  it('renders nothing when the stats could not be read', () => {
    expect(renderToStaticMarkup(<HeroStatsView stats={null} />)).toBe('');
  });

  it('never emits the fabricated figures it replaced', () => {
    const html = renderToStaticMarkup(<HeroStatsView stats={STATS} />);

    for (const bogus of ['47K', '1,200+', '8.2M', '45+', '99.9%']) {
      expect(html, `${bogus} must not reappear on the hero`).not.toContain(bogus);
    }
  });

  it('does not round a small figure up to a friendlier magnitude', () => {
    const html = renderToStaticMarkup(<HeroStatsView stats={STATS} />);

    expect(html).not.toContain('$11K');
    expect(html).not.toContain('M+');
  });
});

describe('HeroStats (fetching)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the figures the API returns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, stats: STATS }),
      }),
    );

    render(<HeroStats />);

    await waitFor(() => expect(screen.getByText('544')).toBeDefined());
    expect(screen.getByText('$11,360')).toBeDefined();
    expect(screen.getByText('103')).toBeDefined();
  });

  it('renders nothing before the fetch resolves', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const { container } = render(<HeroStats />);

    // No skeleton and no placeholder digits: an unmeasured number must not
    // appear even for a frame.
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const { container } = render(<HeroStats />);

    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('renders nothing when the request rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { container } = render(<HeroStats />);

    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('renders nothing when the payload reports failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'Stats temporarily unavailable' }),
      }),
    );

    const { container } = render(<HeroStats />);

    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});
