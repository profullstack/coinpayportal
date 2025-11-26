import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CoinPayPortal - Non-Custodial Crypto Payment Gateway',
  description: 'Accept cryptocurrency payments in your e-commerce store with automatic fee handling and real-time processing',
  keywords: ['cryptocurrency', 'payment gateway', 'crypto payments', 'non-custodial', 'blockchain', 'bitcoin', 'ethereum'],
  authors: [{ name: 'CoinPayPortal' }],
  creator: 'CoinPayPortal',
  publisher: 'CoinPayPortal',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CoinPayPortal',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://coinpayportal.com',
    title: 'CoinPayPortal - Non-Custodial Crypto Payment Gateway',
    description: 'Accept cryptocurrency payments with automatic fee handling and real-time processing',
    siteName: 'CoinPayPortal',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CoinPayPortal - Non-Custodial Crypto Payment Gateway',
    description: 'Accept cryptocurrency payments with automatic fee handling and real-time processing',
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#a855f7' },
    { media: '(prefers-color-scheme: dark)', color: '#a855f7' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}