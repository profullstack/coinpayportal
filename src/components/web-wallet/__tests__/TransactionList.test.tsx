import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransactionList, type TransactionItem } from '../TransactionList';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const mockTransactions: TransactionItem[] = [
  {
    id: 'tx-1',
    txHash: '0xabc123',
    chain: 'ETH',
    type: 'send',
    amount: '1.5',
    status: 'confirmed',
    fromAddress: '0x1111111111111111111111111111111111111111',
    toAddress: '0x2222222222222222222222222222222222222222',
    createdAt: new Date(Date.now() - 60000).toISOString(), // 1 min ago
  },
  {
    id: 'tx-2',
    txHash: '0xdef456',
    chain: 'BTC',
    type: 'receive',
    amount: '0.01',
    status: 'pending',
    fromAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    toAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hr ago
  },
];

describe('TransactionList', () => {
  it('should render transaction items', () => {
    render(<TransactionList transactions={mockTransactions} />);

    // Text is lowercase in DOM, styled with CSS capitalize
    expect(screen.getByText('send')).toBeInTheDocument();
    expect(screen.getByText('receive')).toBeInTheDocument();
  });

  it('should show amounts with +/- prefix', () => {
    render(<TransactionList transactions={mockTransactions} />);

    expect(screen.getByText('-1.5')).toBeInTheDocument();
    expect(screen.getByText('+0.01')).toBeInTheDocument();
  });

  it('should show chain badges', () => {
    render(<TransactionList transactions={mockTransactions} />);

    expect(screen.getByText('ETH')).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();
  });

  it('should show status badges', () => {
    render(<TransactionList transactions={mockTransactions} />);

    expect(screen.getByText('confirmed')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('should show relative time', () => {
    render(<TransactionList transactions={mockTransactions} />);

    expect(screen.getByText('1m ago')).toBeInTheDocument();
    expect(screen.getByText('1h ago')).toBeInTheDocument();
  });

  it('should link to transaction detail page', () => {
    render(<TransactionList transactions={mockTransactions} />);

    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/web-wallet/tx/ETH:0xabc123');
    expect(links[1]).toHaveAttribute('href', '/web-wallet/tx/BTC:0xdef456');
  });

  it('should show loading skeleton', () => {
    const { container } = render(
      <TransactionList transactions={[]} isLoading />
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show empty state with custom message', () => {
    render(
      <TransactionList
        transactions={[]}
        emptyMessage="Nothing here yet"
      />
    );
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('should show default empty message', () => {
    render(<TransactionList transactions={[]} />);
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
  });

  it('should show send direction arrows', () => {
    render(<TransactionList transactions={mockTransactions} />);

    // Send arrow (↑) and receive arrow (↓)
    expect(screen.getByText('\u2191')).toBeInTheDocument();
    expect(screen.getByText('\u2193')).toBeInTheDocument();
  });
});
