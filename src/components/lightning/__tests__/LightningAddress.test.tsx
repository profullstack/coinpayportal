import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LightningAddress } from '../LightningAddress';

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('LightningAddress', () => {
  it('shows input when no address registered', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ lightning_address: null }),
    });

    render(<LightningAddress walletId="w1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('username')).toBeInTheDocument();
    });
    expect(screen.getByText('Claim Lightning Address')).toBeInTheDocument();
  });

  it('shows existing address with copy button', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        lightning_address: 'alice@coinpayportal.com',
        username: 'alice',
      }),
    });

    render(<LightningAddress walletId="w1" />);

    await waitFor(() => {
      expect(screen.getByText('alice@coinpayportal.com')).toBeInTheDocument();
    });
    expect(screen.getByText('Click to copy')).toBeInTheDocument();
  });

  it('registers a new username', async () => {
    // Initial check — no address
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ lightning_address: null }),
    });

    render(<LightningAddress walletId="w1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('username')).toBeInTheDocument();
    });

    // Type username
    fireEvent.change(screen.getByPlaceholderText('username'), {
      target: { value: 'bob' },
    });

    // Availability check
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ available: true }),
    });

    await waitFor(() => {
      expect(screen.getByText('Username is available')).toBeInTheDocument();
    });

    // Mock registration
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        lightning_address: 'bob@coinpayportal.com',
        username: 'bob',
      }),
    });

    fireEvent.click(screen.getByText('Claim Lightning Address'));

    await waitFor(() => {
      expect(screen.getByText('Lightning Address registered!')).toBeInTheDocument();
    });
  });

  it('shows unavailable state for duplicate username and blocks submit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ lightning_address: null }),
    });

    render(<LightningAddress walletId="w1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('username')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('username'), {
      target: { value: 'taken' },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ available: false }),
    });

    await waitFor(() => {
      expect(screen.getByText('Username is taken')).toBeInTheDocument();
    });

    const claimButton = screen.getByText('Claim Lightning Address') as HTMLButtonElement;
    expect(claimButton.disabled).toBe(true);
  });

  it('filters invalid characters from username input', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ lightning_address: null }),
    });

    render(<LightningAddress walletId="w1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('username')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('username') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice@#$123' } });

    // Should filter to lowercase alphanumeric
    expect(input.value).toBe('alice123');
  });
});
