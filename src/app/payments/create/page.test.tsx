/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import CreatePaymentPage from './page';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('CreatePaymentPage', () => {
  const mockPush = vi.fn();
  const mockRouter = {
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  const mockBusinesses = [
    { id: 'business-1', name: 'Test Business 1' },
    { id: 'business-2', name: 'Test Business 2' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter);
    localStorage.clear();
    localStorage.setItem('auth_token', 'test-token');
  });

  describe('Loading State', () => {
    it('should show loading spinner initially', () => {
      vi.mocked(fetch).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<CreatePaymentPage />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('No Businesses State', () => {
    it('should show message when no businesses exist', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [],
        }),
      } as Response);

      render(<CreatePaymentPage />);

      await waitFor(() => {
        expect(screen.getByText(/no businesses found/i)).toBeInTheDocument();
      });

      expect(
        screen.getByText(/you need to create a business before you can accept payments/i)
      ).toBeInTheDocument();
    });

    it('should have button to create business', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [],
        }),
      } as Response);

      render(<CreatePaymentPage />);

      await waitFor(() => {
        const createButton = screen.getByText(/create business/i);
        expect(createButton).toBeInTheDocument();
      });
    });
  });

  describe('Payment Form', () => {
    beforeEach(async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: mockBusinesses,
        }),
      } as Response);
    });

    it('should render payment creation form', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /create payment/i })).toBeInTheDocument();
      });

      expect(screen.getByLabelText(/business/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/amount \(usd\)/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/cryptocurrency/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    });

    it('should populate business dropdown', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        const select = screen.getByLabelText(/business/i) as HTMLSelectElement;
        expect(select.options).toHaveLength(2);
        expect(select.options[0].text).toBe('Test Business 1');
        expect(select.options[1].text).toBe('Test Business 2');
      });
    });

    it('should show payment breakdown with fees', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        expect(
          screen.getByText(/Payment Breakdown/i)
        ).toBeInTheDocument();
      });
      
      // Check for fee info - use queryAllByText since elements may appear multiple times
      expect(screen.queryAllByText(/Network Fee/i).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/Customer Pays/i).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/platform fee/i).length).toBeGreaterThan(0);
    });

    it('should have all currency options', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        const select = screen.getByLabelText(/cryptocurrency/i) as HTMLSelectElement;
        expect(select.options).toHaveLength(4);
        expect(select.options[0].text).toContain('Bitcoin');
        expect(select.options[1].text).toContain('Ethereum');
        expect(select.options[2].text).toContain('Polygon');
        expect(select.options[3].text).toContain('Solana');
      });
    });
  });

  describe('Create Payment', () => {
    beforeEach(async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: mockBusinesses,
        }),
      } as Response);
    });

    it.skip('should create payment successfully', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        screen.getByLabelText(/amount \(usd\)/i);
      });

      const amountInput = screen.getByLabelText(/amount \(usd\)/i);
      const currencySelect = screen.getByLabelText(/cryptocurrency/i);
      const submitButton = screen.getByRole('button', { name: /create payment/i });

      fireEvent.change(amountInput, { target: { value: '100' } });
      fireEvent.change(currencySelect, { target: { value: 'eth' } });

      // Mock payment creation
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            id: 'payment-123',
            amount_crypto: '0.05',
            amount_usd: '100.00',
            currency: 'eth',
            status: 'pending',
            payment_address: '0xpaymentaddress',
            description: null,
          },
        }),
      } as Response);

      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/payments/create',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"amount_usd":100'),
          })
        );
      });
    });

    it.skip('should show success page after creation', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        screen.getByLabelText(/amount \(usd\)/i);
      });

      const amountInput = screen.getByLabelText(/amount \(usd\)/i);
      const submitButton = screen.getByRole('button', { name: /create payment/i });

      fireEvent.change(amountInput, { target: { value: '50' } });

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            id: 'payment-123',
            amount_crypto: '0.025',
            amount_usd: '50.00',
            currency: 'btc',
            status: 'pending',
            payment_address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
            description: 'Test payment',
          },
        }),
      } as Response);

      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/payment created successfully/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2/i)).toBeInTheDocument();
      expect(screen.getByText(/payment-123/i)).toBeInTheDocument();
    });

    it.skip('should display QR code on success', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        screen.getByLabelText(/amount \(usd\)/i);
      });

      const amountInput = screen.getByLabelText(/amount \(usd\)/i);
      const submitButton = screen.getByRole('button', { name: /create payment/i });

      fireEvent.change(amountInput, { target: { value: '25' } });

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            id: 'payment-456',
            amount_crypto: '0.0125',
            amount_usd: '25.00',
            currency: 'btc',
            status: 'pending',
            payment_address: '1Address',
          },
        }),
      } as Response);

      fireEvent.click(submitButton);

      await waitFor(() => {
        const qrImage = screen.getByAltText(/payment qr code/i);
        expect(qrImage).toBeInTheDocument();
        expect(qrImage).toHaveAttribute('src', '/api/payments/payment-456/qr');
      });
    });

    it.skip('should allow creating another payment', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        screen.getByLabelText(/amount \(usd\)/i);
      });

      const amountInput = screen.getByLabelText(/amount \(usd\)/i);
      const submitButton = screen.getByRole('button', { name: /create payment/i });

      fireEvent.change(amountInput, { target: { value: '10' } });

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment: {
            id: 'payment-789',
            amount_crypto: '0.005',
            amount_usd: '10.00',
            currency: 'btc',
            status: 'pending',
            payment_address: '1Another',
          },
        }),
      } as Response);

      fireEvent.click(submitButton);

      await waitFor(() => {
        screen.getByText(/payment created successfully/i);
      });

      const createAnotherButton = screen.getByText(/create another/i);
      fireEvent.click(createAnotherButton);

      await waitFor(() => {
        expect(screen.getByLabelText(/amount \(usd\)/i)).toBeInTheDocument();
        expect(screen.queryByText(/payment created successfully/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it.skip('should display error when payment creation fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: mockBusinesses,
        }),
      } as Response);

      render(<CreatePaymentPage />);

      await waitFor(() => {
        screen.getByLabelText(/amount \(usd\)/i);
      });

      const amountInput = screen.getByLabelText(/amount \(usd\)/i);
      const submitButton = screen.getByRole('button', { name: /create payment/i });

      fireEvent.change(amountInput, { target: { value: '100' } });

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: 'Payment creation failed',
        }),
      } as Response);

      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/payment creation failed/i)).toBeInTheDocument();
      });
    });

    it('should redirect to login if no token', async () => {
      localStorage.removeItem('auth_token');

      render(<CreatePaymentPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('Form Validation', () => {
    beforeEach(async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: mockBusinesses,
        }),
      } as Response);
    });

    it('should require amount field', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        const amountInput = screen.getByLabelText(/amount \(usd\)/i);
        expect(amountInput).toBeRequired();
      });
    });

    it.skip('should update form state when typing', async () => {
      render(<CreatePaymentPage />);

      await waitFor(() => {
        screen.getByLabelText(/amount \(usd\)/i);
      });

      const amountInput = screen.getByLabelText(/amount \(usd\)/i) as HTMLInputElement;
      const descriptionInput = screen.getByLabelText(/description/i) as HTMLTextAreaElement;

      fireEvent.change(amountInput, { target: { value: '75.50' } });
      fireEvent.change(descriptionInput, { target: { value: 'Test payment' } });

      expect(amountInput.value).toBe('75.50');
      expect(descriptionInput.value).toBe('Test payment');
    });
  });
});