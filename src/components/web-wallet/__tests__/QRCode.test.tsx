import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QRCode } from '../QRCode';

// Mock qrcode library
vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('QRCode', () => {
  it('should render canvas element', () => {
    const { container } = render(<QRCode value="1ABC123" />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('should have appropriate aria-label', () => {
    render(<QRCode value="1ABC123" />);
    expect(screen.getByRole('img', { name: /QR code for 1ABC123/ })).toBeInTheDocument();
  });

  it('should use label in aria-label when provided', () => {
    render(<QRCode value="1ABC123" label="BTC address" />);
    expect(screen.getByRole('img', { name: /QR code for BTC address/ })).toBeInTheDocument();
  });

  it('should show label text below QR code', () => {
    render(<QRCode value="1ABC123" label="BTC address" />);
    expect(screen.getByText('BTC address')).toBeInTheDocument();
  });

  it('should show placeholder when value is empty', () => {
    render(<QRCode value="" />);
    expect(screen.getByText('No address')).toBeInTheDocument();
  });

  it('should render at custom size', () => {
    const { container } = render(<QRCode value="1ABC" size={300} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });
});
