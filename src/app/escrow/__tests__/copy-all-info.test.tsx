import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildEscrowCopyLines } from '../create/copy-lines';

describe('Copy All Info functionality', () => {
  let mockClipboard: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockClipboard = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: mockClipboard },
    });
  });

  // ── Single escrow confirmation "Copy All" ──

  it('copies formatted escrow info to clipboard', async () => {
    const escrow = {
      id: 'esc_test123',
      escrow_address: '0xescrow',
      amount: 100,
      chain: 'USDC_POL',
      status: 'pending',
      created_at: '2025-01-01T00:00:00Z',
      expires_at: '2025-01-08T00:00:00Z',
      depositor_address: '0xabc',
      beneficiary_address: '0xdef',
      amount_usd: 100,
      release_token: 'tok_release',
      beneficiary_token: 'tok_ben',
      fee_amount: 1,
    };

    const lines = buildEscrowCopyLines(escrow, null, true);
    const info = lines.join('\n');

    await navigator.clipboard.writeText(info);

    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Escrow ID: esc_test123'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Deposit Address: 0xescrow'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Release Token: tok_release'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Beneficiary Token: tok_ben'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Commission: 1 USDC_POL'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('USD Value: ≈ $100.00'));
  });

  it('excludes optional fields when null', async () => {
    const escrow = {
      id: 'esc_abc',
      escrow_address: '0x123',
      amount: 50,
      chain: 'ETH',
      status: 'funded',
      expires_at: '2025-02-08T00:00:00Z',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      amount_usd: null as number | null,
      release_token: 'tok_r',
      beneficiary_token: 'tok_b',
      fee_amount: null as number | null,
    };

    const lines = buildEscrowCopyLines(escrow, null, true);
    const info = lines.join('\n');

    expect(info).not.toContain('USD Value');
    expect(info).not.toContain('Commission');
  });

  // ── Series confirmation "Copy All" ──

  it('copies full series info including first escrow', async () => {
    const s = {
      id: 'ser_abc',
      amount: '50',
      coin: 'USDC_POL',
      currency: 'USD',
      interval: 'monthly',
      payment_method: 'crypto',
      max_periods: 8,
      status: 'active',
      next_charge_at: '2026-03-01T00:00:00Z',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      description: 'Monthly payment',
    };

    const escrow = {
      id: 'esc_first',
      escrow_address: '0xescrow_addr',
      amount: 50,
      chain: 'USDC_POL',
      release_token: 'rtok',
      beneficiary_token: 'btok',
      expires_at: '2026-03-01T00:00:00Z',
    };

    const lines = buildEscrowCopyLines(escrow, s, true);
    const info = lines.join('\n');

    await navigator.clipboard.writeText(info);

    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Series ID: ser_abc'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Max Periods: 8'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Escrow ID: esc_first'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Release Token: rtok'));
  });

  it('omits extra fields when includeAllFields is false', () => {
    const escrow = {
      id: 'esc_min',
      escrow_address: '0xescrow',
      amount: 75,
      chain: 'ETH',
      status: 'pending',
      created_at: '2025-01-01T00:00:00Z',
      expires_at: '2025-01-08T00:00:00Z',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      amount_usd: 75,
      release_token: 'tok_release',
      beneficiary_token: 'tok_ben',
      fee_amount: 1,
      allow_auto_release: true,
    };

    const lines = buildEscrowCopyLines(escrow, null, false);
    const info = lines.join('\n');

    expect(info).toContain('Coin: ETH');
    expect(info).toContain('Address: 0xescrow');
    expect(info).not.toContain('Escrow ID');
    expect(info).not.toContain('Deposit Address');
    expect(info).not.toContain('Amount:');
    expect(info).not.toContain('Status:');
    expect(info).not.toContain('USD Value');
    expect(info).not.toContain('Release Token');
    expect(info).not.toContain('Beneficiary Token');
    expect(info).not.toContain('Commission');
    expect(info).not.toContain('Auto-release at expiry');
  });
});
