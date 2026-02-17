import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';

// Mock Next.js hooks
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

// Import component after mocks
import EscrowManagePageWrapper from '../manage/page';

// Mock fetch globally
global.fetch = vi.fn();

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
};

const mockEscrowWithCommission = {
  id: 'esc_commission_123',
  depositor_address: '0xdepositor123',
  beneficiary_address: '0xbeneficiary456',
  escrow_address: '0xescrow789',
  chain: 'USDC_POL',
  amount: 200,
  amount_usd: 200,
  fee_amount: 2.0, // 1% commission
  deposited_amount: 200, // Funded escrow
  status: 'funded',
  deposit_tx_hash: '0xdeposittx123',
  settlement_tx_hash: null,
  metadata: { description: 'Test escrow with commission' },
  dispute_reason: null,
  dispute_resolution: null,
  created_at: '2024-01-01T00:00:00Z',
  funded_at: '2024-01-01T01:00:00Z',
  released_at: null,
  settled_at: null,
  disputed_at: null,
  refunded_at: null,
  expires_at: '2024-01-02T00:00:00Z',
};

const mockEvents = [
  {
    id: 'event_1',
    escrow_id: 'esc_commission_123',
    event_type: 'created',
    actor: '0xdepositor123',
    details: { amount: 200, chain: 'USDC_POL' },
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'event_2',
    escrow_id: 'esc_commission_123',
    event_type: 'funded',
    actor: '0xdepositor123',
    details: { deposited_amount: 200 },
    created_at: '2024-01-01T01:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  
  // Setup default mocks
  (useRouter as any).mockReturnValue(mockRouter);
  
  // Mock clipboard API
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

describe('EscrowManagePage - Commission Displays', () => {
  it('should display commission and beneficiary net amount for funded escrow', async () => {
    const mockParams = new URLSearchParams('?id=esc_commission_123&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);

    // Mock successful auth response
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: mockEscrowWithCommission,
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

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });

    // Check commission display
    expect(screen.getByText('Platform Commission')).toBeInTheDocument();
    expect(screen.getByText('2 USDC_POL (1.0%)')).toBeInTheDocument();
    
    // Check beneficiary net amount
    expect(screen.getByText(/Beneficiary receives: 198\.000000 USDC_POL/)).toBeInTheDocument();
  });

  it('should not display commission section when fee_amount is null', async () => {
    const escrowNoCommission = {
      ...mockEscrowWithCommission,
      fee_amount: null
    };

    const mockParams = new URLSearchParams('?id=esc_no_fee&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: escrowNoCommission,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: [] }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });

    // Should not show commission section
    expect(screen.queryByText('Platform Commission')).not.toBeInTheDocument();
    expect(screen.queryByText(/Beneficiary receives:/)).not.toBeInTheDocument();
  });

  it('should not display commission section when fee_amount is zero', async () => {
    const escrowZeroCommission = {
      ...mockEscrowWithCommission,
      fee_amount: 0
    };

    const mockParams = new URLSearchParams('?id=esc_zero_fee&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: escrowZeroCommission,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: [] }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });

    // Should not show commission section
    expect(screen.queryByText('Platform Commission')).not.toBeInTheDocument();
  });

  it('should display correct commission for different amounts', async () => {
    const smallAmountEscrow = {
      ...mockEscrowWithCommission,
      amount: 0.1,
      fee_amount: 0.001,
      deposited_amount: 0.1,
      chain: 'BTC'
    };

    const mockParams = new URLSearchParams('?id=esc_small&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: smallAmountEscrow,
            role: 'beneficiary',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: [] }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });

    // Check commission display for small amount
    expect(screen.getByText('Platform Commission')).toBeInTheDocument();
    expect(screen.getByText('0.001 BTC (1.0%)')).toBeInTheDocument();
    
    // Check beneficiary net amount calculation
    expect(screen.getByText(/Beneficiary receives: 0\.099000 BTC/)).toBeInTheDocument();
  });

  it('should show copy amount functionality on pending deposit escrow', async () => {
    const pendingEscrow = {
      ...mockEscrowWithCommission,
      status: 'pending',
      deposited_amount: null,
      deposit_tx_hash: null
    };

    const mockParams = new URLSearchParams('?id=esc_pending&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);

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
          json: () => Promise.resolve({ events: [] }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });

    // Check deposit instructions
    expect(screen.getByText((content, element) => {
      return element?.tagName === 'P' && (element.textContent || '').includes('Send exactly 200 USDC_POL');
    })).toBeInTheDocument();
    
    // Check copy amount functionality
    expect(screen.getByText('Copy amount')).toBeInTheDocument();
  });

  it('should copy amount correctly when copy button is clicked', async () => {
    const pendingEscrow = {
      ...mockEscrowWithCommission,
      status: 'pending',
      deposited_amount: null,
      deposit_tx_hash: null,
      amount: 1.5
    };

    const mockParams = new URLSearchParams('?id=esc_copy_test&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);

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
          json: () => Promise.resolve({ events: [] }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });

    // Click copy amount button
    const copyAmountButton = screen.getByText('Copy amount');
    fireEvent.click(copyAmountButton);

    // Verify clipboard was called with correct amount
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('1.5');
    });

    // Verify button shows copied state
    expect(screen.getByText('Amount copied!')).toBeInTheDocument();
  });

  it('should display commission percentage correctly with high precision amounts', async () => {
    const highPrecisionEscrow = {
      ...mockEscrowWithCommission,
      amount: 0.000123,
      fee_amount: 0.00000123,
      deposited_amount: 0.000123,
      chain: 'BTC'
    };

    const mockParams = new URLSearchParams('?id=esc_precision&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: highPrecisionEscrow,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: [] }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });

    // Check high precision commission calculation
    expect(screen.getByText('0.00000123 BTC (1.0%)')).toBeInTheDocument();
    
    // Check high precision beneficiary amount (0.000123 - 0.00000123)
    expect(screen.getByText(/Beneficiary receives: 0\.000122 BTC/)).toBeInTheDocument();
  });

  it('should work correctly for beneficiary role viewing commission', async () => {
    const mockParams = new URLSearchParams('?id=esc_beneficiary&token=beneficiary_token');
    (useSearchParams as any).mockReturnValue(mockParams);

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: mockEscrowWithCommission,
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

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
      expect(screen.getByText('beneficiary')).toBeInTheDocument();
    });

    // Beneficiary should also see commission details
    expect(screen.getByText('Platform Commission')).toBeInTheDocument();
    expect(screen.getByText('2 USDC_POL (1.0%)')).toBeInTheDocument();
    expect(screen.getByText(/Beneficiary receives: 198\.000000 USDC_POL/)).toBeInTheDocument();
  });

  it('should handle various chain types correctly in commission display', async () => {
    const ethereumEscrow = {
      ...mockEscrowWithCommission,
      chain: 'ETH',
      amount: 2.5,
      fee_amount: 0.025,
      deposited_amount: 2.5
    };

    const mockParams = new URLSearchParams('?id=esc_eth&token=test_token');
    (useSearchParams as any).mockReturnValue(mockParams);

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/auth')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            escrow: ethereumEscrow,
            role: 'depositor',
          }),
        });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: [] }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<EscrowManagePageWrapper />);
    
    await waitFor(() => {
      expect(screen.getByText('Escrow Management')).toBeInTheDocument();
    });

    // Check ETH chain commission display
    expect(screen.getByText('0.025 ETH (1.0%)')).toBeInTheDocument();
    expect(screen.getByText(/Beneficiary receives: 2\.475000 ETH/)).toBeInTheDocument();
  });
});