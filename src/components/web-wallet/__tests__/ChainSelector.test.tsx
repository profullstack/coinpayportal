import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChainSelector, ChainMultiSelect } from '../ChainSelector';

describe('ChainSelector', () => {
  it('should render select with all chains', () => {
    render(<ChainSelector value="" onChange={vi.fn()} />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    // Should have "Select chain" + 14 chain options
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(15); // 1 placeholder + 14 chains
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
