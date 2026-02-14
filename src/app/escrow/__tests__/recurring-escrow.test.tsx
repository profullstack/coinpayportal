import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// Mock auth fetch
vi.mock('@/lib/auth/client', () => ({
  authFetch: vi.fn().mockResolvedValue(null),
}));

// Mock fetch globally
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

import CreateEscrowPage from '../create/page';

describe('CreateEscrowPage - Make Recurring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Make Recurring checkbox', () => {
    render(<CreateEscrowPage />);
    expect(screen.getByLabelText(/make recurring/i)).toBeInTheDocument();
  });

  it('does not show interval/max periods when unchecked', () => {
    render(<CreateEscrowPage />);
    expect(screen.queryByLabelText(/interval/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/max periods/i)).not.toBeInTheDocument();
  });

  it('shows interval and max periods when checked', () => {
    render(<CreateEscrowPage />);
    fireEvent.click(screen.getByLabelText(/make recurring/i));
    expect(screen.getByLabelText(/interval/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max periods/i)).toBeInTheDocument();
  });

  it('has correct interval options', () => {
    render(<CreateEscrowPage />);
    fireEvent.click(screen.getByLabelText(/make recurring/i));
    const intervalSelect = screen.getByLabelText(/interval/i);
    expect(intervalSelect).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('Biweekly')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
  });

  it('hides recurring fields when unchecked again', () => {
    render(<CreateEscrowPage />);
    const checkbox = screen.getByLabelText(/make recurring/i);
    fireEvent.click(checkbox);
    expect(screen.getByLabelText(/interval/i)).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(screen.queryByLabelText(/interval/i)).not.toBeInTheDocument();
  });
});
