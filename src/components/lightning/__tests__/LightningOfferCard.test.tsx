import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LightningOfferCard } from '../LightningOfferCard';
import type { LnOffer } from '@/lib/lightning/types';

const baseOffer: LnOffer = {
  id: 'offer-1',
  node_id: 'node-1',
  business_id: 'biz-1',
  bolt12_offer: 'lno1abcdef1234567890',
  description: 'Coffee Payment',
  amount_msat: 100000,
  currency: 'BTC',
  status: 'active',
  total_received_msat: 500000,
  payment_count: 5,
  last_payment_at: '2026-02-14T12:00:00Z',
  metadata: {},
  created_at: '2026-02-01T00:00:00Z',
};

describe.skip('LightningOfferCard', () => {
  it('should render offer description', () => {
    render(<LightningOfferCard offer={baseOffer} />);
    expect(screen.getByText('Coffee Payment')).toBeDefined();
  });

  it('should display amount in sats', () => {
    render(<LightningOfferCard offer={baseOffer} />);
    expect(screen.getByText('100 sats')).toBeDefined();
  });

  it('should display "Any amount" when amount_msat is null', () => {
    render(<LightningOfferCard offer={{ ...baseOffer, amount_msat: null }} />);
    expect(screen.getByText('Any amount')).toBeDefined();
  });

  it('should show active status badge', () => {
    render(<LightningOfferCard offer={baseOffer} />);
    expect(screen.getByText('active')).toBeDefined();
  });

  it('should show disabled status badge', () => {
    render(<LightningOfferCard offer={{ ...baseOffer, status: 'disabled' }} />);
    expect(screen.getByText('disabled')).toBeDefined();
  });

  it('should show payment stats when payments exist', () => {
    render(<LightningOfferCard offer={baseOffer} />);
    expect(screen.getByText('5 payments')).toBeDefined();
    expect(screen.getByText('500 sats received')).toBeDefined();
  });

  it('should not show stats when payment_count is 0', () => {
    render(<LightningOfferCard offer={{ ...baseOffer, payment_count: 0 }} />);
    expect(screen.queryByText('payments')).toBeNull();
  });

  it('should render copy button', () => {
    render(<LightningOfferCard offer={baseOffer} />);
    expect(screen.getByText('Copy BOLT12 Offer')).toBeDefined();
  });

  it('should render open in wallet link', () => {
    render(<LightningOfferCard offer={baseOffer} />);
    const link = screen.getByText('Open in Wallet');
    expect(link.closest('a')?.getAttribute('href')).toBe('lightning:lno1abcdef1234567890');
  });

  it('should copy offer to clipboard on button click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<LightningOfferCard offer={baseOffer} />);
    fireEvent.click(screen.getByText('Copy BOLT12 Offer'));

    expect(writeText).toHaveBeenCalledWith('lno1abcdef1234567890');
  });
});
