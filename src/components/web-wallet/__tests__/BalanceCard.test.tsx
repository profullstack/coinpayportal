import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BalanceCard } from '../BalanceCard';

describe('BalanceCard', () => {
  it('should display formatted USD balance', () => {
    render(<BalanceCard totalUsd={12345.67} />);
    expect(screen.getByText('$12,345.67')).toBeInTheDocument();
  });

  it('should display zero balance', () => {
    render(<BalanceCard totalUsd={0} />);
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('should display large balance with commas', () => {
    render(<BalanceCard totalUsd={1234567.89} />);
    expect(screen.getByText('$1,234,567.89')).toBeInTheDocument();
  });

  it('should show loading skeleton when isLoading', () => {
    const { container } = render(<BalanceCard totalUsd={0} isLoading />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('should show "Total Balance" label', () => {
    render(<BalanceCard totalUsd={100} />);
    expect(screen.getByText('Total Balance')).toBeInTheDocument();
  });

  it('should show USD label', () => {
    render(<BalanceCard totalUsd={100} />);
    expect(screen.getByText('USD')).toBeInTheDocument();
  });
});
