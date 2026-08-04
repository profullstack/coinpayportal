/**
 * Pins the two behaviours that matter for the hero counters: measured numbers
 * are rendered as measured, and an unreadable database renders nothing rather
 * than a comforting placeholder.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroStats } from './HeroStats';
import { SETTLEMENT_ASSET_COUNT } from '@/lib/wallets/supported-chains';

// The real production figures at the time of writing.
const STATS = { paymentsSettled: 544, activeBusinesses: 103, settledVolumeUsd: 11360.15 };

describe('HeroStats', () => {
  it('renders the measured figures', () => {
    const html = renderToStaticMarkup(<HeroStats stats={STATS} />);

    expect(html).toContain('544');
    expect(html).toContain('103');
    expect(html).toContain('$11,360');
    expect(html).toContain(String(SETTLEMENT_ASSET_COUNT));
    expect(html).toContain('Payments Settled');
    expect(html).toContain('Settled Volume');
  });

  it('renders nothing when the stats could not be read', () => {
    expect(renderToStaticMarkup(<HeroStats stats={null} />)).toBe('');
  });

  it('never emits the fabricated figures it replaced', () => {
    const html = renderToStaticMarkup(<HeroStats stats={STATS} />);

    for (const bogus of ['47K', '1,200+', '8.2M', '45+', '99.9%']) {
      expect(html, `${bogus} must not reappear on the hero`).not.toContain(bogus);
    }
  });

  it('does not round a small figure up to a friendlier magnitude', () => {
    const html = renderToStaticMarkup(<HeroStats stats={STATS} />);

    expect(html).not.toContain('$11K');
    expect(html).not.toContain('M+');
  });
});
