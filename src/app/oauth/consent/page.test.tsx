/**
 * @vitest-environment jsdom
 */

/**
 * The consent screen is the only place a user learns what an app may do
 * before clicking Authorize. It used to look scopes up in a local map and
 * return null for anything missing, so a request for
 * `openid profile email wallet:read merchant` listed four harmless items and
 * said nothing about the one that acts as the merchant account.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}));

import ConsentPage from './page';

function renderWithScope(scope: string) {
  query = new URLSearchParams({
    client_id: 'cp_test_client',
    redirect_uri: 'https://app.example.test/callback',
    scope,
    response_type: 'code',
  }).toString();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ name: 'Example App' }),
  }) as unknown as typeof fetch;
  return render(<ConsentPage />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OAuth consent page', () => {
  it('lists the merchant scope, set apart as the powerful one', () => {
    const { container } = renderWithScope('openid profile email wallet:read merchant');
    const items = container.querySelectorAll('li[data-scope]');
    expect([...items].map((li) => li.getAttribute('data-scope'))).toEqual([
      'openid', 'profile', 'email', 'wallet:read', 'merchant',
    ]);
    expect(screen.getByText('Merchant account (full access)')).toBeTruthy();
    const merchant = container.querySelector('li[data-scope="merchant"]')!;
    expect(merchant.className).toContain('border-amber-600');
    expect(merchant.textContent).toContain('send payouts');
    const wallet = container.querySelector('li[data-scope="wallet:read"]')!;
    expect(wallet.className).not.toContain('amber');
  });

  it('shows the did scope', () => {
    renderWithScope('openid did');
    expect(screen.getByText('DID')).toBeTruthy();
  });

  it('shows an unknown scope by name rather than hiding it', () => {
    const { container } = renderWithScope('openid ledger:write');
    expect(container.querySelector('li[data-scope="ledger:write"]')).toBeTruthy();
    expect(screen.getByText('ledger:write')).toBeTruthy();
  });
});
