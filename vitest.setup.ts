import { expect, afterEach, vi, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// Setup localStorage mock with actual storage
beforeAll(() => {
  const store: Record<string, string> = {};
  
  const localStorageMock = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach(key => delete store[key]);
    },
  };
  
  global.localStorage = localStorageMock as any;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  if (global.localStorage) {
    global.localStorage.clear();
  }
});

// Mock ws module to prevent WebSocket import errors from ethers
vi.mock('ws', () => ({
  default: class WebSocket {},
  WebSocket: class WebSocket {},
}));