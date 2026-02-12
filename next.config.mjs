/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  },
  // Transpile wallet packages that have ESM/CJS issues
  transpilePackages: [
    '@profullstack/coinpay',
    '@reown/appkit',
    '@reown/appkit-adapter-wagmi',
    '@reown/appkit-controllers',
    '@walletconnect/universal-provider',
    '@walletconnect/utils',
    '@walletconnect/logger',
    '@solana/wallet-adapter-base',
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-react-ui',
    '@solana/wallet-adapter-wallets',
    '@solana/wallet-adapter-phantom',
    '@solana/wallet-adapter-solflare',
    '@noble/hashes',
    '@noble/curves',
    'openpgp',
  ],
  // Turbopack configuration
  turbopack: {
    resolveAlias: {
      // Handle optional peer dependencies that may not be installed
      '@gemini-wallet/core': '@reown/appkit-adapter-wagmi/dist/esm/src/index.js',
      'porto': '@reown/appkit-adapter-wagmi/dist/esm/src/index.js',
    },
  },
};

export default nextConfig;