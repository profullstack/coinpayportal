import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

// Mock ws module to prevent WebSocket import errors from ethers
vi.mock('ws', () => ({
  default: class WebSocket {},
  WebSocket: class WebSocket {},
}));