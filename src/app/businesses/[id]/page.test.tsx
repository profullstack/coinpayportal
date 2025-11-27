/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useRouter, useParams } from 'next/navigation';
import BusinessDetailPage from './page';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useParams: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn();

const mockBusiness = {
  id: 'business-123',
  name: 'Test Business',
  description: 'Test Description',
  webhook_url: 'https://example.com/webhook',
  webhook_secret: 'secret-123',
  api_key: 'api-key-123',
  created_at: '2024-01-01T00:00:00Z',
};

const mockWallets = [
  {
    id: 'wallet-1',
    business_id: 'business-123',
    cryptocurrency: 'BTC',
    wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'wallet-2',
    business_id: 'business-123',
    cryptocurrency: 'ETH',
    wallet_address: '0xabcdef1234567890',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
];

describe('BusinessDetailPage', () => {
  const mockPush = vi.fn();
  const mockRouter = {
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter);
    vi.mocked(useParams).mockReturnValue({ id: 'business-123' });
    localStorage.setItem('auth_token', 'test-token');
    
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  describe('Page Loading', () => {
    it('should show loading state initially', () => {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
      
      render(<BusinessDetailPage />);
      
      expect(screen.getByText('Loading business...')).toBeInTheDocument();
    });

    it('should redirect to login if no auth token', () => {
      localStorage.removeItem('auth_token');
      
      render(<BusinessDetailPage />);
      
      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    it('should fetch business and wallets on mount', async () => {
      vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
        const urlString = url.toString();
        if (urlString.includes('/wallets')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, wallets: mockWallets }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, business: mockBusiness }),
        } as Response);
      });

      render(<BusinessDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Test Business' })).toBeInTheDocument();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/businesses/business-123',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        })
      );
    });

    it('should show error if business fetch fails', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ success: false, error: 'Business not found' }),
      } as Response);

      render(<BusinessDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Business not found')).toBeInTheDocument();
      });
    });
  });

  describe('Tab Navigation', () => {
    beforeEach(async () => {
      vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
        const urlString = url.toString();
        if (urlString.includes('/wallets')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, wallets: mockWallets }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, business: mockBusiness }),
        } as Response);
      });
    });

    it('should show General tab by default', async () => {
      render(<BusinessDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Business Information')).toBeInTheDocument();
      });
    });

    it('should switch to Wallets tab when clicked', async () => {
      render(<BusinessDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Test Business' })).toBeInTheDocument();
      });

      const walletsTab = screen.getByRole('button', { name: /Wallets \(2\)/i });
      fireEvent.click(walletsTab);

      await waitFor(() => {
        expect(screen.getByText('Multi-Crypto Wallets')).toBeInTheDocument();
      });
    });

    it('should switch to Webhooks tab when clicked', async () => {
      render(<BusinessDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Test Business' })).toBeInTheDocument();
      });

      const webhooksTab = screen.getByRole('button', { name: /Webhooks/i });
      fireEvent.click(webhooksTab);

      await waitFor(() => {
        expect(screen.getByText('Webhook Configuration')).toBeInTheDocument();
      });
    });

    it('should switch to API Keys tab when clicked', async () => {
      render(<BusinessDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Test Business' })).toBeInTheDocument();
      });

      const apiKeysTab = screen.getByRole('button', { name: /API Keys/i });
      fireEvent.click(apiKeysTab);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'API Keys', level: 2 })).toBeInTheDocument();
      });
    });
  });

  describe('Copy to Clipboard', () => {
    beforeEach(async () => {
      vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
        const urlString = url.toString();
        if (urlString.includes('/wallets')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, wallets: mockWallets }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, business: mockBusiness }),
        } as Response);
      });
    });

    it('should copy wallet address to clipboard from Wallets tab', async () => {
      render(<BusinessDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Test Business' })).toBeInTheDocument();
      });

      // Switch to Wallets tab
      const walletsTab = screen.getByRole('button', { name: /Wallets \(2\)/i });
      fireEvent.click(walletsTab);

      await waitFor(() => {
        expect(screen.getByText('Multi-Crypto Wallets')).toBeInTheDocument();
      });

      const copyButtons = screen.getAllByTitle('Copy to clipboard');
      fireEvent.click(copyButtons[0]);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
        expect(screen.getByText(/BTC wallet address copied to clipboard/i)).toBeInTheDocument();
      });
    });
  });

  describe('Back Navigation', () => {
    beforeEach(async () => {
      vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
        const urlString = url.toString();
        if (urlString.includes('/wallets')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, wallets: [] }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, business: mockBusiness }),
        } as Response);
      });
    });

    it('should navigate back to businesses list', async () => {
      render(<BusinessDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Test Business' })).toBeInTheDocument();
      });

      const backButton = screen.getByRole('button', { name: /Back to Businesses/i });
      fireEvent.click(backButton);

      expect(mockPush).toHaveBeenCalledWith('/businesses');
    });
  });
});