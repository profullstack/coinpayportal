/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import LoginPage from './page';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('LoginPage', () => {
  const mockPush = vi.fn();
  const mockRouter = {
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter);
    localStorage.clear();
  });

  describe('Rendering', () => {
    it('should render login form with all elements', () => {
      render(<LoginPage />);

      expect(screen.getByText('Welcome back')).toBeInTheDocument();
      expect(screen.getByText('Log in to your CoinPay account')).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
      expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
      expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
    });

    it('should have proper input attributes', () => {
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      expect(emailInput).toHaveAttribute('type', 'email');
      expect(emailInput).toHaveAttribute('required');
      expect(emailInput).toHaveAttribute('autocomplete', 'email');

      expect(passwordInput).toHaveAttribute('type', 'password');
      expect(passwordInput).toHaveAttribute('required');
      expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
    });

    it('should have links to signup and forgot password', () => {
      render(<LoginPage />);

      const signupLink = screen.getByRole('link', { name: /sign up/i });
      const forgotPasswordLink = screen.getByRole('link', { name: /forgot password/i });

      expect(signupLink).toHaveAttribute('href', '/signup');
      expect(forgotPasswordLink).toHaveAttribute('href', '/forgot-password');
    });
  });

  describe('Form Validation', () => {
    it('should require email and password fields', () => {
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      expect(emailInput).toBeRequired();
      expect(passwordInput).toBeRequired();
    });

    it('should update form state when typing', () => {
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      expect(emailInput.value).toBe('test@example.com');
      expect(passwordInput.value).toBe('password123');
    });
  });

  describe('Successful Login', () => {
    it('should login successfully and redirect to dashboard', async () => {
      const mockResponse = {
        success: true,
        token: 'mock-jwt-token',
        merchant: {
          id: 'merchant-123',
          email: 'test@example.com',
          name: 'Test Merchant',
          is_admin: false,
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'SecurePassword123!' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'SecurePassword123!',
          }),
        });
      });

      await waitFor(() => {
        expect(localStorage.getItem('auth_token')).toBe('mock-jwt-token');
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('should redirect admin users to admin page', async () => {
      const mockResponse = {
        success: true,
        token: 'mock-jwt-token',
        merchant: {
          id: 'admin-123',
          email: 'admin@example.com',
          name: 'Admin User',
          is_admin: true,
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'admin@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'AdminPassword123!' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });

    it.skip('should show loading state during login', async () => {
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({
                    success: true,
                    token: 'mock-token',
                    merchant: { id: '123', email: 'test@example.com' },
                  }),
                } as Response),
              100
            )
          )
      );

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitButton);

      expect(screen.getByText(/logging in/i)).toBeInTheDocument();
      expect(submitButton).toBeDisabled();

      await waitFor(() => {
        expect(screen.queryByText(/logging in/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Failed Login', () => {
    it('should display error for invalid credentials', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid email or password',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'wrong@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
      });

      expect(mockPush).not.toHaveBeenCalled();
      expect(localStorage.getItem('auth_token')).toBeNull();
    });

    it('should display error when API returns error without ok status', async () => {
      const mockResponse = {
        success: false,
        error: 'Account locked',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/account locked/i)).toBeInTheDocument();
      });
    });

    it('should display generic error when API returns success false', async () => {
      const mockResponse = {
        success: false,
        error: 'Database error',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/database error/i)).toBeInTheDocument();
      });
    });

    it('should handle network errors gracefully', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/an error occurred/i)).toBeInTheDocument();
      });

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should clear error when user starts typing again', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid credentials',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'wrong' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
      });

      // Start typing again - error should clear on form submit
      fireEvent.change(passwordInput, { target: { value: 'newpassword' } });
      
      // Mock successful response for retry
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          token: 'new-token',
          merchant: { id: '123', email: 'test@example.com' },
        }),
      } as Response);

      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Token Storage', () => {
    it('should store token in localStorage on successful login', async () => {
      const mockResponse = {
        success: true,
        token: 'test-jwt-token-12345',
        merchant: {
          id: 'merchant-123',
          email: 'test@example.com',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(localStorage.getItem('auth_token')).toBe('test-jwt-token-12345');
      });
    });

    it('should not store token if login fails', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid credentials',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'wrong' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
      });

      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(<LoginPage />);

      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it('should have proper form structure', () => {
      render(<LoginPage />);

      const form = screen.getByRole('button', { name: /log in/i }).closest('form');
      expect(form).toBeInTheDocument();
    });

    it('should show error in accessible way', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid credentials',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => mockResponse,
      } as Response);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'wrong' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        const errorElement = screen.getByText(/invalid credentials/i);
        expect(errorElement).toBeInTheDocument();
        expect(errorElement.closest('div')).toHaveClass('bg-red-50');
      });
    });
  });
});