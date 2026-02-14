import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StripeApiKeysTab } from './StripeApiKeysTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockAuthFetch = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

describe('StripeApiKeysTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows empty state', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, keys: [], account_id: 'acct_123' } });
    render(<StripeApiKeysTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('No restricted API keys.')).toBeTruthy();
    });
  });

  it('shows account id', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, keys: [], account_id: 'acct_xyz' } });
    render(<StripeApiKeysTab businessId="biz-1" />);
    await waitFor(() => {
      expect(screen.getByText('acct_xyz')).toBeTruthy();
    });
  });

  it('shows create form', async () => {
    mockAuthFetch.mockResolvedValue({ response: { ok: true }, data: { success: true, keys: [], account_id: 'acct_123' } });
    render(<StripeApiKeysTab businessId="biz-1" />);
    await waitFor(() => screen.getByText('Create Restricted Key'));
    fireEvent.click(screen.getByText('Create Restricted Key'));
    await waitFor(() => {
      expect(screen.getByText('Key Name')).toBeTruthy();
    });
  });
});
