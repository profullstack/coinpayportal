import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AmountInput } from '../AmountInput';

describe('AmountInput', () => {
  it('should render with label', () => {
    render(<AmountInput value="" onChange={vi.fn()} label="Amount" />);
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
  });

  it('should render with placeholder', () => {
    render(<AmountInput value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
  });

  it('should call onChange with cleaned value', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '1.5' },
    });
    expect(onChange).toHaveBeenCalledWith('1.5');
  });

  it('should strip non-numeric characters', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '1.5abc' },
    });
    expect(onChange).toHaveBeenCalledWith('1.5');
  });

  it('should not allow multiple decimal points', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '1.5.3' },
    });
    // Should not call onChange since input is invalid
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should show symbol', () => {
    render(<AmountInput value="1.5" onChange={vi.fn()} symbol="BTC" />);
    expect(screen.getByText('BTC')).toBeInTheDocument();
  });

  it('should show MAX button when maxAmount is provided', () => {
    const onChange = vi.fn();
    render(
      <AmountInput value="" onChange={onChange} maxAmount="10.5" />
    );

    const maxBtn = screen.getByText('MAX');
    expect(maxBtn).toBeInTheDocument();

    fireEvent.click(maxBtn);
    expect(onChange).toHaveBeenCalledWith('10.5');
  });

  it('should show USD value', () => {
    render(
      <AmountInput value="1" onChange={vi.fn()} usdValue="50,000.00" />
    );
    expect(screen.getByText(/50,000.00 USD/)).toBeInTheDocument();
  });

  it('should show error state', () => {
    render(
      <AmountInput value="" onChange={vi.fn()} error="Insufficient funds" />
    );
    expect(screen.getByText('Insufficient funds')).toBeInTheDocument();
  });

  it('should disable input when disabled', () => {
    render(<AmountInput value="" onChange={vi.fn()} disabled />);
    expect(screen.getByPlaceholderText('0.00')).toBeDisabled();
  });
});
