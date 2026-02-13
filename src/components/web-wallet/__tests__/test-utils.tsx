import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Mock wallet state for testing components that use useWebWallet().
 */
export interface MockWalletState {
  hasWallet?: boolean;
  isUnlocked?: boolean;
  wallet?: any;
  walletId?: string | null;
  chains?: string[];
  isLoading?: boolean;
  error?: string | null;
  createWallet?: (...args: any[]) => Promise<any>;
  importWallet?: (...args: any[]) => Promise<any>;
  unlock?: (password: string) => Promise<boolean>;
  lock?: () => void;
  deleteWallet?: () => void;
  clearError?: () => void;
}

const defaultMockState: Required<MockWalletState> = vi.hoisted(() => ({
  hasWallet: false,
  isUnlocked: false,
  wallet: null,
  walletId: null,
  chains: ['BTC', 'ETH', 'SOL'],
  isLoading: false,
  error: null,
  createWallet: vi.fn().mockResolvedValue({ mnemonic: 'test words', walletId: 'wid-123' }),
  importWallet: vi.fn().mockResolvedValue({ walletId: 'wid-123' }),
  unlock: vi.fn().mockResolvedValue(true),
  lock: vi.fn(),
  deleteWallet: vi.fn(),
  clearError: vi.fn(),
}));

// We mock the WalletContext module so useWebWallet returns our mock
let currentMockState: Required<MockWalletState> = { ...defaultMockState };

export function setMockWalletState(overrides: MockWalletState) {
  currentMockState = { ...defaultMockState, ...overrides };
}

export function getMockWalletState() {
  return currentMockState;
}

// This must be called in vi.mock at the top of each test file
export function createMockUseWebWallet() {
  return () => currentMockState;
}

/**
 * Custom render that doesn't need the real provider.
 * Components under test should have WalletContext mocked via vi.mock.
 */
export function renderWithMocks(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, options);
}
