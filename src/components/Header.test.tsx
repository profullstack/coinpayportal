/**
 * @vitest-environment jsdom
 */

/**
 * The nav has a failure mode that looks like success: a link renders, points
 * somewhere real, and still cannot be followed.
 *
 * `getNavHref` rewrites any href outside `PUBLIC_ROUTES` to
 * `/login?redirect=…`. So adding a public marketing page to `navigation` but
 * forgetting `PUBLIC_ROUTES` produces a nav entry that bounces a logged-out
 * visitor to a login wall for a page that needs no account. That is worse than
 * leaving it unlinked, and nothing about the markup looks wrong.
 *
 * Remittance shipped with neither — live, working, reachable only by typing the
 * URL. These tests cover both halves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Header from './Header';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({ ok: false } as Response);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function hrefOf(name: string): string | null {
  // Desktop and mobile navs render the same entries, so take the first.
  const link = screen.getAllByRole('link', { name }).at(0);
  return link?.getAttribute('href') ?? null;
}

describe('Header nav, logged out', () => {
  it('offers Remittance', () => {
    render(<Header />);

    expect(screen.getAllByRole('link', { name: 'Remittance' }).length).toBeGreaterThan(0);
  });

  it('links Remittance straight to the page, not to a login wall', () => {
    render(<Header />);

    // The whole point: quoting needs no account.
    expect(hrefOf('Remittance')).toBe('/remittance');
    expect(hrefOf('Remittance')).not.toContain('/login');
  });

  it('still gates a genuinely private route behind login', () => {
    // Guards the inverse mistake — making everything public to fix the above.
    render(<Header />);

    const reputation = hrefOf('Reputation');
    expect(reputation).toContain('/login');
    expect(reputation).toContain('redirect');
  });

  it('leaves the other public routes reachable', () => {
    render(<Header />);

    expect(hrefOf('Wallet')).toBe('/web-wallet');
    expect(hrefOf('Blog')).toBe('/blog');
    expect(hrefOf('Pricing')).toBe('/pricing');
  });
});
