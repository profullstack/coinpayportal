import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetList, type AssetItem } from '../AssetList';

const mockAssets: AssetItem[] = [
  {
    chain: 'BTC',
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    balance: '0.5',
    usdValue: 25000,
  },
  {
    chain: 'ETH',
    address: '0x1234567890abcdef1234567890abcdef12345678',
    balance: '10.0',
    usdValue: 35000,
  },
];

describe('AssetList', () => {
  it('should render asset items', () => {
    render(<AssetList assets={mockAssets} />);

    expect(screen.getByText('0.5 BTC')).toBeInTheDocument();
    expect(screen.getByText('10.0 ETH')).toBeInTheDocument();
  });

  it('should show USD values', () => {
    render(<AssetList assets={mockAssets} />);

    expect(screen.getByText('$25,000.00')).toBeInTheDocument();
    expect(screen.getByText('$35,000.00')).toBeInTheDocument();
  });

  it('should show truncated addresses', () => {
    render(<AssetList assets={mockAssets} />);
    expect(screen.getByText(/1A1zP1eP5Q\.\.\.DivfNa/)).toBeInTheDocument();
  });

  it('should show chain badges', () => {
    render(<AssetList assets={mockAssets} />);
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('ETH')).toBeInTheDocument();
  });

  it('should call onSelect when clicking an asset', () => {
    const onSelect = vi.fn();
    render(<AssetList assets={mockAssets} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('0.5 BTC').closest('button')!);
    expect(onSelect).toHaveBeenCalledWith(mockAssets[0]);
  });

  it('should show loading skeleton', () => {
    const { container } = render(<AssetList assets={[]} isLoading />);
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show empty state', () => {
    render(<AssetList assets={[]} />);
    expect(screen.getByText('No assets yet')).toBeInTheDocument();
  });

  it('should handle USDC chain symbol mapping', () => {
    const usdcAssets: AssetItem[] = [
      {
        chain: 'USDC_ETH',
        address: '0xabc123',
        balance: '1000.00',
        usdValue: 1000,
      },
    ];
    render(<AssetList assets={usdcAssets} />);
    expect(screen.getByText('1000.00 USDC')).toBeInTheDocument();
  });
});
