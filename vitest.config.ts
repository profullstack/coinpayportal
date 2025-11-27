import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()] as any,
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Explicitly include SDK package tests
    include: [
      'src/**/*.test.{ts,tsx}',
      'packages/sdk/test/**/*.test.js',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      // Skip blockchain tests due to ws CommonJS/ESM incompatibility
      'src/lib/blockchain/providers.test.ts',
      'src/lib/blockchain/wallets.test.ts',
      'src/lib/blockchain/monitor.test.ts',
    ],
    environmentMatchGlobs: [
      // Use jsdom for React component tests
      ['**/*.tsx', 'jsdom'],
      // Use node for everything else
      ['**/*.ts', 'node'],
      // SDK tests use node environment
      ['packages/sdk/**/*.js', 'node'],
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@noble/curves/secp256k1': path.resolve(__dirname, './node_modules/.pnpm/@noble+curves@2.0.1/node_modules/@noble/curves/secp256k1.js'),
    },
    conditions: ['node', 'import', 'module', 'browser', 'default'],
  },
  define: {
    'global': 'globalThis',
  },
});