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
  // Transpile packages that have ESM/CJS issues.
  //
  // The @reown/*, @walletconnect/* and @solana/wallet-adapter-* entries were
  // removed along with the packages themselves: nothing in this repo ever
  // imported a wallet adapter, and they existed only as declared dependencies.
  // They dragged in react-native -> metro -> image-size, whose two DoS CVEs
  // have no upstream fix, so dropping them was the only way to clear that alert.
  // @solana/web3.js is NOT part of that set and stays — it is used directly for
  // Solana key derivation and RPC.
  transpilePackages: [
    '@profullstack/coinpay',
    '@noble/hashes',
    '@noble/curves',
    'openpgp',
  ],
  // Security headers
  async headers() {
    return [
      // Serve /install.sh as text/plain so `curl | sh` works cleanly
      // and browsers display the script inline (users can audit before
      // piping). Security headers from the catch-all below still apply.
      {
        source: '/install.sh',
        headers: [
          { key: 'Content-Type', value: 'text/plain; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
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
              "script-src 'self' 'unsafe-inline' https://datafa.st https://crawlproof.com https://invitejs.trustpilot.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: https://crawlproof.com",
              "font-src 'self' data:",
              "connect-src 'self' https: wss: https://crawlproof.com",
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
  //
  // The resolveAlias entries that stubbed @gemini-wallet/core and porto onto
  // @reown/appkit-adapter-wagmi are gone with that package. They were shims for
  // optional peers of appkit; with appkit out of the tree nothing requests
  // either module, and the aliases pointed at a path that no longer exists.
};

export default nextConfig;
