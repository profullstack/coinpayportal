import { expect, afterEach, vi, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// Supabase connection env, for the whole suite.
//
// Service-role clients are now built through createServiceClient(), which
// refuses to run without these rather than passing `undefined` down to
// createClient — a route with no credentials must fail loudly, not silently
// operate under the anon key or a placeholder. Tests mock the Supabase client
// itself, so these only need to be present, not real.
//
// Set here rather than in each test file so a new route test does not have to
// rediscover the requirement. Individual tests can still override with
// vi.stubEnv, including deleting them to exercise the failure path.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

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