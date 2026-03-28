import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GlobalWalletsPage from './page';

const mockAuthFetch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: any[]) => mockAuthFetch(...args),
}));

describe('GlobalWalletsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthFetch.mockResolvedValue({
      response: { ok: true },
      data: { success: true, wallets: [] },
    });
  });

  it('shows chain-specific USDT options when adding a wallet', async () => {
    const user = userEvent.setup();
    render(<GlobalWalletsPage />);

    await waitFor(() => {
      expect(screen.getByText('Global Wallet Addresses')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Wallet'));

    const cryptoSelect = screen.getByRole('combobox');
    const optionLabels = Array.from(cryptoSelect.querySelectorAll('option')).map((option) => option.textContent);

    expect(optionLabels).toContain('USDT (Ethereum)');
    expect(optionLabels).toContain('USDT (Polygon) — Low Fees');
    expect(optionLabels).toContain('USDT (Solana) — Low Fees');
    expect(optionLabels).toContain('USDC (Ethereum)');
    expect(optionLabels).toContain('USDC (Polygon) — Low Fees');
    expect(optionLabels).toContain('USDC (Solana) — Low Fees');
  });
});
