import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The web wallet's reference signer (imported only by the differential test)
  // uses the bare '@noble/curves/secp256k1' specifier, which @noble v2's exports
  // no longer allow. Alias it to the concrete .js entry so the reference loads.
  resolve: {
    alias: { '@noble/curves/secp256k1': '@noble/curves/secp256k1.js' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
