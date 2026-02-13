import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResetPasswordPage from './page';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams('token=test-token')),
}));

describe('ResetPasswordPage', () => {
  it('should render the reset password form', () => {
    render(<ResetPasswordPage />);
    expect(screen.getByText('Set new password')).toBeDefined();
    expect(screen.getByText('Reset password')).toBeDefined();
  });
});
