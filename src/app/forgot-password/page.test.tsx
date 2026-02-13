import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ForgotPasswordPage from './page';

describe('ForgotPasswordPage', () => {
  it('should render the forgot password form', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByText('Reset your password')).toBeDefined();
    expect(screen.getByLabelText('Email Address')).toBeDefined();
    expect(screen.getByText('Send reset link')).toBeDefined();
  });
});
