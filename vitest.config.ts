import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()] as any,
  test: {
    environment: 'node',
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
      // These were all excluded for a ws CommonJS/ESM incompatibility. The `ws`
      // alias below fixes that, and the exclusions outlived it — four of the
      // seven files now run clean and are back in the suite.
      //
      // Leaving them out had a cost. `system-wallet.test.ts` covers custodial
      // address derivation, and while it sat unrun its ADA test asserted the
      // shape of a *broken* address (`addr1_<hex>...`, ellipsis and all), so
      // the L5-02 defect had a passing-looking test defending it. Production
      // issued five unusable ADA addresses before anyone noticed.
      //
      // The three below no longer fail on module loading either — they fail on
      // assertions that drifted while nobody was running them. That is a
      // to-do, not a module problem; do not re-add the others without checking.
      'src/lib/blockchain/wallets.test.ts',
      'src/lib/payments/service.test.ts',
      'src/app/api/cron/monitor-payments/route.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force ws to ESM-compatible shim during tests (ethers transitively imports ws)
      'ws': path.resolve(__dirname, './src/test/ws-shim.ts'),
      '@noble/curves/secp256k1': path.resolve(__dirname, './node_modules/@noble/curves/secp256k1.js'),
      '@noble/curves/ed25519': path.resolve(__dirname, './node_modules/@noble/curves/ed25519.js'),
      // @dayflow/react ships a CJS dist/index.js under "type": "module" which
      // throws "require is not defined in ES module scope" when vitest loads
      // it. The package also ships dist/index.esm.js — alias to that ESM
      // build so the CalendarTab import chain resolves cleanly.
      '@dayflow/react': path.resolve(__dirname, './node_modules/@dayflow/react/dist/index.esm.js'),
    },
    conditions: ['node', 'import', 'module', 'browser', 'default'],
  },
  define: {
    'global': 'globalThis',
  },
});
