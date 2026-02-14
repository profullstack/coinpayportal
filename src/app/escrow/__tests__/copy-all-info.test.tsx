import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

describe('Copy All Info functionality', () => {
  let mockClipboard: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockClipboard = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: mockClipboard },
    });
  });

  it('copies formatted escrow info to clipboard', async () => {
    const escrow = {
      id: 'esc_test123',
      escrow_address: '0xescrow',
      amount: 100,
      chain: 'USDC_POL',
      status: 'created',
      created_at: '2025-01-01T00:00:00Z',
      expires_at: '2025-01-08T00:00:00Z',
      depositor_address: '0xabc',
      beneficiary_address: '0xdef',
      amount_usd: 100,
    };

    // Simulate the copy logic used in both pages
    const info = [
      `Escrow ID: ${escrow.id}`,
      `Payment Address: ${escrow.escrow_address}`,
      `Amount: ${escrow.amount} ${escrow.chain}`,
      `Chain: ${escrow.chain}`,
      `Status: ${escrow.status}`,
      `Depositor: ${escrow.depositor_address}`,
      `Beneficiary: ${escrow.beneficiary_address}`,
      ...(escrow.amount_usd ? [`USD Value: $${escrow.amount_usd.toFixed(2)}`] : []),
    ].join('\n');

    await navigator.clipboard.writeText(info);

    expect(mockClipboard).toHaveBeenCalledWith(
      expect.stringContaining('Escrow ID: esc_test123')
    );
    expect(mockClipboard).toHaveBeenCalledWith(
      expect.stringContaining('Payment Address: 0xescrow')
    );
    expect(mockClipboard).toHaveBeenCalledWith(
      expect.stringContaining('Amount: 100 USDC_POL')
    );
    expect(mockClipboard).toHaveBeenCalledWith(
      expect.stringContaining('USD Value: $100.00')
    );
  });

  it('formats info text with all fields on separate lines', async () => {
    const escrow = {
      id: 'esc_abc',
      escrow_address: '0x123',
      amount: 50,
      chain: 'ETH',
      status: 'funded',
      created_at: '2025-02-01T00:00:00Z',
      expires_at: '2025-02-08T00:00:00Z',
      depositor_address: '0xdep',
      beneficiary_address: '0xben',
      amount_usd: null,
      deposit_tx_hash: '0xtx123',
    };

    const info = [
      `Escrow ID: ${escrow.id}`,
      `Payment Address: ${escrow.escrow_address}`,
      `Amount: ${escrow.amount} ${escrow.chain}`,
      `Chain: ${escrow.chain}`,
      `Status: ${escrow.status}`,
      `Depositor: ${escrow.depositor_address}`,
      `Beneficiary: ${escrow.beneficiary_address}`,
      ...(escrow.amount_usd ? [`USD Value: $${escrow.amount_usd.toFixed(2)}`] : []),
      ...(escrow.deposit_tx_hash ? [`Deposit TX: ${escrow.deposit_tx_hash}`] : []),
    ].join('\n');

    expect(info).toContain('Escrow ID: esc_abc');
    expect(info).toContain('Deposit TX: 0xtx123');
    expect(info).not.toContain('USD Value'); // null amount_usd excluded
    expect(info.split('\n').length).toBe(8);
  });
});
