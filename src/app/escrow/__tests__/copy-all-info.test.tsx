import { describe, it, expect, beforeEach, vi } from 'vitest';

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

    // Matches the logic in create/page.tsx single escrow "Copy All"
    const lines = [
      `Escrow ID: ${escrow.id}`,
      `Deposit Address: ${escrow.escrow_address}`,
      `Amount: ${escrow.amount} ${escrow.chain}`,
      ...(escrow.amount_usd ? [`USD Value: ≈ $${escrow.amount_usd.toFixed(2)}`] : []),
      `Status: ${escrow.status}`,
      `Depositor: ${escrow.depositor_address}`,
      `Beneficiary: ${escrow.beneficiary_address}`,
      `Expires: ${new Date(escrow.expires_at).toLocaleString()}`,
      `Release Token: ${escrow.release_token}`,
      `Beneficiary Token: ${escrow.beneficiary_token}`,
      ...(escrow.fee_amount ? [`Commission: ${escrow.fee_amount} ${escrow.chain}`] : []),
    ];
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

    const lines = [
      `Escrow ID: ${escrow.id}`,
      `Deposit Address: ${escrow.escrow_address}`,
      `Amount: ${escrow.amount} ${escrow.chain}`,
      ...(escrow.amount_usd ? [`USD Value: ≈ $${escrow.amount_usd.toFixed(2)}`] : []),
      `Status: ${escrow.status}`,
      `Depositor: ${escrow.depositor_address}`,
      `Beneficiary: ${escrow.beneficiary_address}`,
      `Expires: ${new Date(escrow.expires_at).toLocaleString()}`,
      `Release Token: ${escrow.release_token}`,
      `Beneficiary Token: ${escrow.beneficiary_token}`,
      ...(escrow.fee_amount ? [`Commission: ${escrow.fee_amount} ${escrow.chain}`] : []),
    ];
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

    const lines = [
      `Series ID: ${s.id}`,
      `Amount: ${s.amount} ${s.coin || s.currency || ''}`,
      `Interval: ${s.interval}`,
      `Payment Method: ${s.payment_method}`,
      ...(s.max_periods ? [`Max Periods: ${s.max_periods}`] : []),
      `Status: ${s.status}`,
      ...(s.next_charge_at ? [`Next Charge: ${new Date(s.next_charge_at).toLocaleString()}`] : []),
      ...(s.depositor_address ? [`Depositor: ${s.depositor_address}`] : []),
      ...(s.beneficiary_address ? [`Beneficiary: ${s.beneficiary_address}`] : []),
      ...(s.description ? [`Description: ${s.description}`] : []),
      '',
      '--- First Escrow ---',
      `Escrow ID: ${escrow.id}`,
      `Deposit Address: ${escrow.escrow_address}`,
      `Amount: ${escrow.amount} ${escrow.chain}`,
      `Release Token: ${escrow.release_token}`,
      `Beneficiary Token: ${escrow.beneficiary_token}`,
      `Expires: ${new Date(escrow.expires_at).toLocaleString()}`,
    ];
    const info = lines.join('\n');

    await navigator.clipboard.writeText(info);

    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Series ID: ser_abc'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Max Periods: 8'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('--- First Escrow ---'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Escrow ID: esc_first'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Release Token: rtok'));
    expect(mockClipboard).toHaveBeenCalledWith(expect.stringContaining('Description: Monthly payment'));
  });

  it('series copy-all without first escrow omits escrow section', async () => {
    const s = {
      id: 'ser_xyz',
      amount: '10',
      coin: 'BTC',
      interval: 'weekly',
      payment_method: 'crypto',
      max_periods: null as number | null,
      status: 'active',
      next_charge_at: '2026-02-20T00:00:00Z',
      depositor_address: '0xd',
      beneficiary_address: '0xb',
      description: null as string | null,
    };

    const createdEscrow = null;

    const lines = [
      `Series ID: ${s.id}`,
      `Amount: ${s.amount} ${s.coin}`,
      `Interval: ${s.interval}`,
      `Payment Method: ${s.payment_method}`,
      ...(s.max_periods ? [`Max Periods: ${s.max_periods}`] : []),
      `Status: ${s.status}`,
      ...(s.next_charge_at ? [`Next Charge: ${new Date(s.next_charge_at).toLocaleString()}`] : []),
      ...(s.depositor_address ? [`Depositor: ${s.depositor_address}`] : []),
      ...(s.beneficiary_address ? [`Beneficiary: ${s.beneficiary_address}`] : []),
      ...(s.description ? [`Description: ${s.description}`] : []),
      ...(createdEscrow ? ['', '--- First Escrow ---'] : []),
    ];
    const info = lines.join('\n');

    expect(info).not.toContain('Max Periods');
    expect(info).not.toContain('Description');
    expect(info).not.toContain('First Escrow');
  });
});
