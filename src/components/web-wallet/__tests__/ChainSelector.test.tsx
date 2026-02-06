import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChainSelector, ChainMultiSelect } from '../ChainSelector';

describe('ChainSelector', () => {
  it('should render select with all chains', () => {
    render(<ChainSelector value="" onChange={vi.fn()} />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    // Should have "Select chain" + 17 chain options
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(18); // 1 placeholder + 17 chains
  });

  it('should render with label', () => {
    render(<ChainSelector value="" onChange={vi.fn()} label="Chain" />);
    expect(screen.getByText('Chain')).toBeInTheDocument();
  });

  it('should call onChange when selecting', () => {
    const onChange = vi.fn();
    render(<ChainSelector value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'BTC' },
    });
    expect(onChange).toHaveBeenCalledWith('BTC');
  });

  it('should filter by provided chains list', () => {
    render(
      <ChainSelector
        value=""
        onChange={vi.fn()}
        chains={['BTC', 'ETH']}
      />
    );

    const options = screen.getAllByRole('option');
    // 1 placeholder + 2 chains
    expect(options.length).toBe(3);
  });

  it('should disable when disabled prop is true', () => {
    render(<ChainSelector value="" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('should display balances when provided', () => {
    const balances = {
      BTC: { balance: '1.5', usdValue: 75000 },
      ETH: { balance: '10', usdValue: 30000 },
    };
    render(
      <ChainSelector
        value=""
        onChange={vi.fn()}
        chains={['BTC', 'ETH']}
        balances={balances}
      />
    );

    const options = screen.getAllByRole('option');
    // Check that balance is displayed
    expect(options[1].textContent).toContain('1.50');
    expect(options[2].textContent).toContain('10.00');
  });

  it('should handle zero balances', () => {
    const balances = {
      BTC: { balance: '0', usdValue: 0 },
    };
    render(
      <ChainSelector
        value=""
        onChange={vi.fn()}
        chains={['BTC']}
        balances={balances}
      />
    );

    const options = screen.getAllByRole('option');
    expect(options[1].textContent).toContain('0');
  });

  it('should handle very small balances', () => {
    const balances = {
      BTC: { balance: '0.00001', usdValue: 1 },
    };
    render(
      <ChainSelector
        value=""
        onChange={vi.fn()}
        chains={['BTC']}
        balances={balances}
      />
    );

    const options = screen.getAllByRole('option');
    expect(options[1].textContent).toContain('<0.0001');
  });
});

describe('ChainMultiSelect', () => {
  it('should render all chain options', () => {
    render(<ChainMultiSelect value={[]} onChange={vi.fn()} />);

    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('ETH')).toBeInTheDocument();
    expect(screen.getByText('SOL')).toBeInTheDocument();
  });

  it('should highlight selected chains', () => {
    render(<ChainMultiSelect value={['BTC', 'ETH']} onChange={vi.fn()} />);

    const btcButton = screen.getByText('BTC').closest('button');
    expect(btcButton?.className).toContain('purple-500');
  });

  it('should toggle chain on click', () => {
    const onChange = vi.fn();
    render(<ChainMultiSelect value={['BTC']} onChange={onChange} />);

    // Add ETH
    fireEvent.click(screen.getByText('ETH').closest('button')!);
    expect(onChange).toHaveBeenCalledWith(['BTC', 'ETH']);
  });

  it('should remove chain on click when already selected', () => {
    const onChange = vi.fn();
    render(<ChainMultiSelect value={['BTC', 'ETH']} onChange={onChange} />);

    // Remove BTC
    fireEvent.click(screen.getByText('BTC').closest('button')!);
    expect(onChange).toHaveBeenCalledWith(['ETH']);
  });

  it('should render with label', () => {
    render(
      <ChainMultiSelect
        value={[]}
        onChange={vi.fn()}
        label="Select chains"
      />
    );
    expect(screen.getByText('Select chains')).toBeInTheDocument();
  });
});
