/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
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
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            // Note: 'unsafe-inline' for style-src is required by Next.js for its
            // built-in style injection mechanism (styled-jsx and CSS modules).
            // 'unsafe-eval' has been removed to prevent script injection attacks.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://datafa.st",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss:",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
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