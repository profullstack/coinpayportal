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
  // Next.js will automatically use PORT environment variable
  // No need to specify it in scripts
};

export default nextConfig;