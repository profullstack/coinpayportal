import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddressDisplay, ChainBadge } from '../AddressDisplay';

describe('AddressDisplay', () => {
  const TEST_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

  it('should render truncated address by default', () => {
    render(<AddressDisplay address={TEST_ADDRESS} />);
    // slice(0,10)...slice(-8)
    expect(screen.getByText('0x12345678...12345678')).toBeInTheDocument();
  });

  it('should render full address when truncate is false', () => {
    render(<AddressDisplay address={TEST_ADDRESS} truncate={false} />);
    expect(screen.getByText(TEST_ADDRESS)).toBeInTheDocument();
  });

  it('should show chain badge when chain is provided', () => {
    render(<AddressDisplay address={TEST_ADDRESS} chain="ETH" />);
    expect(screen.getByText('ETH')).toBeInTheDocument();
  });

  it('should show label when provided', () => {
    render(<AddressDisplay address={TEST_ADDRESS} label="Primary" />);
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('should copy address on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AddressDisplay address={TEST_ADDRESS} />);
    fireEvent.click(screen.getByText('Copy'));

    expect(writeText).toHaveBeenCalledWith(TEST_ADDRESS);
  });

  it('should show "Copied" after clicking copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AddressDisplay address={TEST_ADDRESS} />);
    fireEvent.click(screen.getByText('Copy'));

    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
  });
});

describe('ChainBadge', () => {
  it('should render chain name', () => {
    render(<ChainBadge chain="BTC" />);
    expect(screen.getByText('BTC')).toBeInTheDocument();
  });

  it('should replace underscore with space for token chains', () => {
    render(<ChainBadge chain="USDC_ETH" />);
    expect(screen.getByText('USDC ETH')).toBeInTheDocument();
  });

  it('should apply different colors for different chains', () => {
    const { container: btcContainer } = render(<ChainBadge chain="BTC" />);
    const { container: ethContainer } = render(<ChainBadge chain="ETH" />);

    const btcBadge = btcContainer.querySelector('span');
    const ethBadge = ethContainer.querySelector('span');

    expect(btcBadge?.className).toContain('orange');
    expect(ethBadge?.className).toContain('blue');
  });
});
