/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import BusinessesPage from './page';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('BusinessesPage', () => {
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
    localStorage.setItem('auth_token', 'test-token');
  });

  describe('Loading State', () => {
    it('should show loading spinner initially', () => {
      vi.mocked(fetch).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<BusinessesPage />);

      expect(screen.getByText(/loading businesses/i)).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no businesses exist', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [],
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        expect(screen.getByText(/no businesses yet/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/get started by creating your first business/i)).toBeInTheDocument();
    });

    it('should have create button in empty state', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [],
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        const createButtons = screen.getAllByText(/create business/i);
        expect(createButtons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Business List', () => {
    const mockBusinesses = [
      {
        id: 'business-1',
        name: 'Test Business 1',
        description: 'Test description',
        webhook_url: 'https://example.com/webhook',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'business-2',
        name: 'Test Business 2',
        description: null,
        webhook_url: null,
        created_at: '2024-01-02T00:00:00Z',
      },
    ];

    it('should display list of businesses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: mockBusinesses,
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Business 1')).toBeInTheDocument();
        expect(screen.getByText('Test Business 2')).toBeInTheDocument();
      });
    });

    it('should display business details', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: mockBusinesses,
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        expect(screen.getByText('Test description')).toBeInTheDocument();
        // Business cards now only show name, description, and created date
        // Wallet addresses and webhooks are managed in the business detail page
      });
    });

    it('should have edit and delete buttons for each business', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: mockBusinesses,
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        const editButtons = screen.getAllByText(/edit/i);
        const deleteButtons = screen.getAllByText(/delete/i);
        expect(editButtons).toHaveLength(2);
        expect(deleteButtons).toHaveLength(2);
      });
    });
  });

  describe('Create Business', () => {
    it('should open create modal when create button clicked', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [],
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        screen.getByText(/no businesses yet/i);
      });

      const createButton = screen.getAllByText(/create business/i)[0];
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(screen.getByLabelText(/business name/i)).toBeInTheDocument();
        // Wallet address and webhook URL are now configured in business management page
        expect(screen.getByText(/after creating your business/i)).toBeInTheDocument();
      });
    });

    it('should create business successfully', async () => {
      // Mock initial fetch
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [],
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        screen.getByText(/no businesses yet/i);
      });

      // Open modal
      const createButton = screen.getAllByText(/create business/i)[0];
      fireEvent.click(createButton);

      await waitFor(() => {
        screen.getByLabelText(/business name/i);
      });

      // Fill form - now only name and description are required
      const nameInput = screen.getByLabelText(/business name/i);

      fireEvent.change(nameInput, { target: { value: 'New Business' } });

      // Mock create request
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          business: {
            id: 'new-id',
            name: 'New Business',
          },
        }),
      } as Response);

      // Mock refetch
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [
            {
              id: 'new-id',
              name: 'New Business',
              created_at: new Date().toISOString(),
            },
          ],
        }),
      } as Response);

      const submitButton = screen.getByRole('button', { name: /create$/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/businesses',
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });
  });

  describe('Edit Business', () => {
    it('should open edit modal with pre-filled data', async () => {
      const mockBusiness = {
        id: 'business-1',
        name: 'Test Business',
        description: 'Test desc',
        webhook_url: 'https://test.com',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [mockBusiness],
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        screen.getByText('Test Business');
      });

      const editButton = screen.getByText(/edit/i);
      fireEvent.click(editButton);

      await waitFor(() => {
        const nameInput = screen.getByLabelText(/business name/i) as HTMLInputElement;
        expect(nameInput.value).toBe('Test Business');
      });
    });
  });

  describe('Delete Business', () => {
    it('should show confirmation dialog before deleting', async () => {
      const mockBusiness = {
        id: 'business-1',
        name: 'Test Business',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          businesses: [mockBusiness],
        }),
      } as Response);

      // Mock window.confirm
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      render(<BusinessesPage />);

      await waitFor(() => {
        screen.getByText('Test Business');
      });

      const deleteButton = screen.getByText(/delete/i);
      fireEvent.click(deleteButton);

      expect(confirmSpy).toHaveBeenCalledWith(
        'Are you sure you want to delete this business?'
      );

      confirmSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should display error when fetch fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: 'Failed to load businesses',
        }),
      } as Response);

      render(<BusinessesPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed to load businesses/i)).toBeInTheDocument();
      });
    });

    it('should redirect to login if no token', async () => {
      localStorage.removeItem('auth_token');

      render(<BusinessesPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });
  });
});