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
 *
 * Since the nav gained a "More" overflow menu, some of those entries are no
 * longer in the document until it is opened, so `hrefOf` opens it first. A
 * link that is unreachable because it sits in a menu nobody opened is the same
 * class of bug as one pointing at a login wall.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
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

/**
 * Open every "More" menu present, so the whole nav is queryable.
 *
 * Idempotent: the button toggles, so clicking one that is already open would
 * close it again and make a second `hrefOf` in the same test fail.
 */
function openOverflow() {
  for (const button of screen.queryAllByRole('button', { name: /^More$/ })) {
    if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button);
  }
}

function hrefOf(name: string): string | null {
  openOverflow();
  // Desktop and mobile navs render the same entries, so take the first.
  const link = screen.getAllByRole('link', { name }).at(0);
  return link?.getAttribute('href') ?? null;
}

describe('Header nav, logged out', () => {
  it('offers Remittance', () => {
    render(<Header />);
    openOverflow();

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
    expect(hrefOf('Explorer')).toBe('/explorer');
  });
});

describe('Header overflow menu', () => {
  it('keeps the primary entries inline, with no menu to open', () => {
    render(<Header />);

    // These must be reachable without a click; they are the ones a visitor
    // evaluating the product needs.
    for (const name of ['Home', 'Wallet', 'Explorer', 'Pricing', 'API']) {
      expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
    }
  });

  it('hides the overflow entries until More is opened', () => {
    render(<Header />);

    expect(screen.queryByRole('link', { name: 'x402' })).toBeNull();

    openOverflow();

    expect(screen.getAllByRole('link', { name: 'x402' }).length).toBeGreaterThan(0);
  });

  it('reports its state to assistive technology', () => {
    render(<Header />);

    const more = screen.getAllByRole('button', { name: /^More$/ }).at(0)!;
    expect(more.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes again when the same button is clicked', () => {
    render(<Header />);

    const more = screen.getAllByRole('button', { name: /^More$/ }).at(0)!;
    fireEvent.click(more);
    expect(screen.getAllByRole('link', { name: 'x402' }).length).toBeGreaterThan(0);

    fireEvent.click(more);
    expect(screen.queryByRole('link', { name: 'x402' })).toBeNull();
  });

  it('closes on an outside click', () => {
    // Without this the panel floats over the page until its own button is
    // clicked again.
    render(<Header />);

    fireEvent.click(screen.getAllByRole('button', { name: /^More$/ }).at(0)!);
    expect(screen.getAllByRole('link', { name: 'x402' }).length).toBeGreaterThan(0);

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('link', { name: 'x402' })).toBeNull();
  });

  it('closes on Escape', () => {
    render(<Header />);

    fireEvent.click(screen.getAllByRole('button', { name: /^More$/ }).at(0)!);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('link', { name: 'x402' })).toBeNull();
  });

  it('every nav entry is reachable, inline or through More', () => {
    // The guarantee that matters: splitting the nav must not strand an entry.
    render(<Header />);
    openOverflow();

    for (const name of [
      'Home',
      'Wallet',
      'Explorer',
      'Pricing',
      'API',
      'Remittance',
      'Blog',
      'DID',
      'Reputation',
      'x402',
    ]) {
      expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
    }
  });
});

describe('Header mobile menu', () => {
  it('opens, and carries the same entries behind its own More', () => {
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    const nav = screen.getByLabelText('Top');
    // Both navs are in the DOM under jsdom (Tailwind's responsive classes do
    // not apply), so assert on counts rather than visibility: opening the
    // mobile drawer adds a second copy of each primary link.
    expect(within(nav).getAllByRole('link', { name: 'Explorer' }).length).toBe(2);

    // Two More buttons now — desktop and mobile.
    expect(screen.getAllByRole('button', { name: /^More$/ }).length).toBe(2);

    openOverflow();
    expect(within(nav).getAllByRole('link', { name: 'x402' }).length).toBe(2);
  });
});
