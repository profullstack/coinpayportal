/**
 * Tests for Escrow Management Page
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import EscrowManagePage from './page';

// Mock Next.js hooks
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
};

const mockSearchParams = new URLSearchParams();

const mockEscrowData = {
  id: 'esc_123',
  depositor_address: '0xdepositor123',
  beneficiary_address: '0xbeneficiary456',
  escrow_address: '0xescrow789',
  chain: 'USDC_POL',
  amount: 100,
  amount_usd: 100,
  fee_amount: 1,
  deposited_amount: null,
  status: 'created',
  deposit_tx_hash: null,
  settlement_tx_hash: null,
  metadata: { description: 'Test escrow for freelance work' },
  dispute_reason: null,
  dispute_resolution: null,
  created_at: '2024-01-01T00:00:00Z',
  funded_at: null,
  released_at: null,
  settled_at: null,
  disputed_at: null,
  refunded_at: null,
  expires_at: '2024-01-02T00:00:00Z',
};

const mockEvents = [
  {
    id: 'event_1',
    escrow_id: 'esc_123',
    event_type: 'created',
    actor: '0xdepositor123',
    details: { amount: 100, chain: 'USDC_POL' },
    created_at: '2024-01-01T00:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  
  // Setup default mocks
  (useRouter as any).mockReturnValue(mockRouter);
  (useSearchParams as any).mockReturnValue(mockSearchParams);
  
  // Mock successful auth response by default
  (global.fetch as any).mockImplementation((url: string) => {
    if (url.includes('/auth')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          escrow: mockEscrowData,
          role: 'depositor',
        }),
      });
    }
    if (url.includes('/events')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          events: mockEvents,
        }),
      });
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'Not found' }),
    });
  });

  // Mock clipboard API
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

describe('EscrowManagePage', () => {
  it('should render login form when not authenticated', () => {
    render(<EscrowManagePage />);
    
    expect(screen.getByText('Manage Escrow')).toBeInTheDocument();
    expect(screen.getByText('Enter your Escrow ID and Token to access your escrow')).toBeInTheDocument();
    expect(screen.getByLabelText(/escrow id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /access escrow/i })).toBeInTheDocument();
  });

  it('should load URL parameters on mount', () => {
    const mockParams = new URLSearchParams('?id=esc_123&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    expect(screen.getByDisplayValue('esc_123')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test_token')).toBeInTheDocument();
  });

  it('should authenticate successfully with valid credentials', async () => {
    render(<EscrowManagePage />);
    
    // Fill in the form
    fireEvent.change(screen.getByLabelText(/escrow id/i), {
      target: { value: 'esc_123' },
    });
    fireEvent.change(screen.getByLabelText(/access token/i), {
      target: { value: 'valid_token' },
    });
    
    // Submit form
    fireEvent.click(screen.getByRole('button', { name: /access escrow/i }));
    
    // Wait for authentication to complete
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });
    
    expect(screen.getByText('depositor')).toBeInTheDocument();
    expect(screen.getByText('100 USDC_POL')).toBeInTheDocument();
  });

  it('should show error for invalid credentials', async () => {
    (global.fetch as any).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid authentication token' }),
      })
    );

    render(<EscrowManagePage />);
    
    fireEvent.change(screen.getByLabelText(/escrow id/i), {
      target: { value: 'esc_123' },
    });
    fireEvent.change(screen.getByLabelText(/access token/i), {
      target: { value: 'invalid_token' },
    });
    
    fireEvent.click(screen.getByRole('button', { name: /access escrow/i }));
    
    await waitFor(() => {
      expect(screen.getByText('Invalid authentication token')).toBeInTheDocument();
    });
  });

  it('should display depositor actions for funded escrow', async () => {
    const fundedEscrow = { ...mockEscrowData, status: 'funded', deposited_amount: 100 };
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: fundedEscrow,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: mockEvents }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const mockParams = new URLSearchParams('?id=esc_123&token=release_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    await waitFor(() => {
      expect(screen.getByText('Release Funds')).toBeInTheDocument();
      expect(screen.getByText('Request Refund')).toBeInTheDocument();
      expect(screen.getByText('File Dispute')).toBeInTheDocument();
    });
  });

  it('should display beneficiary view for funded escrow', async () => {
    const fundedEscrow = { ...mockEscrowData, status: 'funded', deposited_amount: 100 };
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: fundedEscrow,
            role: 'beneficiary',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: mockEvents }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const mockParams = new URLSearchParams('?id=esc_123&token=beneficiary_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    await waitFor(() => {
      expect(screen.getByText('beneficiary')).toBeInTheDocument();
      expect(screen.getByText('File Dispute')).toBeInTheDocument();
      expect(screen.getByText('Waiting for depositor to release funds')).toBeInTheDocument();
    });
  });

  it('should handle release funds action', async () => {
    const fundedEscrow = { ...mockEscrowData, status: 'funded', deposited_amount: 100 };
    
    // Mock successful auth
    (global.fetch as any).mockImplementation((url: string, options?: any) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: fundedEscrow,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/release')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ...fundedEscrow,
            status: 'released',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: mockEvents }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const mockParams = new URLSearchParams('?id=esc_123&token=release_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    await waitFor(() => {
      expect(screen.getByText('Release Funds')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Release Funds'));
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/release'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ release_token: 'release_token' }),
        })
      );
    });
  });

  it('should handle dispute filing', async () => {
    const fundedEscrow = { ...mockEscrowData, status: 'funded', deposited_amount: 100 };
    
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: fundedEscrow,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/dispute')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ...fundedEscrow,
            status: 'disputed',
            dispute_reason: 'Work not completed as agreed',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: mockEvents }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const mockParams = new URLSearchParams('?id=esc_123&token=release_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    await waitFor(() => {
      expect(screen.getByText('File Dispute')).toBeInTheDocument();
    });
    
    // Open dispute form
    fireEvent.click(screen.getByText('File Dispute'));
    
    // Fill dispute reason
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, {
      target: { value: 'Work not completed as agreed' },
    });
    
    // Submit dispute
    fireEvent.click(screen.getByText('Submit Dispute'));
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/dispute'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            token: 'release_token',
            reason: 'Work not completed as agreed',
          }),
        })
      );
    });
  });

  it('should show pending deposit instructions for pending escrow', async () => {
    const pendingEscrow = { ...mockEscrowData, status: 'pending' };
    
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: pendingEscrow,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: mockEvents }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const mockParams = new URLSearchParams('?id=esc_123&token=release_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    await waitFor(() => {
      // Text is split across elements (<strong> tag), so use a function matcher
      expect(screen.getByText((content, element) => {
        return element?.tagName === 'P' && (element.textContent || '').includes('Send exactly 100 USDC_POL');
      })).toBeInTheDocument();
      expect(screen.getByText('Copy amount')).toBeInTheDocument();
    });
  });

  it('should copy text to clipboard', async () => {
    const mockParams = new URLSearchParams('?id=esc_123&token=release_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    await waitFor(() => {
      expect(screen.getByText(/0xescrow789/)).toBeInTheDocument();
    });
    
    // Find and click copy button for address
    const copyButtons = screen.getAllByText('📋');
    fireEvent.click(copyButtons[0]);
    
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('0xescrow789');
    });
  });

  it('should display event timeline', async () => {
    const mockParams = new URLSearchParams('?id=esc_123&token=release_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    await waitFor(() => {
      expect(screen.getByText('Event Timeline')).toBeInTheDocument();
      // "created" appears both as status badge and event type — just check multiple exist
      expect(screen.getAllByText('created').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('should validate dispute reason length', async () => {
    const fundedEscrow = { ...mockEscrowData, status: 'funded', deposited_amount: 100 };
    
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: fundedEscrow,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: mockEvents }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const mockParams = new URLSearchParams('?id=esc_123&token=release_token');
    (useSearchParams as any).mockReturnValue(mockParams);
    
    render(<EscrowManagePage />);
    
    await waitFor(() => {
      expect(screen.getByText('File Dispute')).toBeInTheDocument();
    });
    
    // Open dispute form
    fireEvent.click(screen.getByText('File Dispute'));
    
    // Try to submit with short reason
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Short' } });
    
    const submitButton = screen.getByText('Submit Dispute');
    expect(submitButton).toBeDisabled();
  });
});