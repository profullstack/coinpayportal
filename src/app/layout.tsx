import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com'),
  title: 'CoinPay - Non-Custodial Crypto Payment Gateway',
  description: 'Accept cryptocurrency payments in your e-commerce store with automatic fee handling and real-time processing',
  keywords: ['cryptocurrency', 'payment gateway', 'crypto payments', 'non-custodial', 'blockchain', 'bitcoin', 'ethereum'],
  authors: [{ name: 'CoinPay' }],
  creator: 'CoinPay',
  publisher: 'CoinPay',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CoinPay',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://coinpayportal.com',
    title: 'CoinPay - Non-Custodial Crypto Payment Gateway',
    description: 'Accept cryptocurrency payments with automatic fee handling and real-time processing',
    siteName: 'CoinPay',
    images: [
      {
        url: '/banner.png',
        width: 1200,
        height: 630,
        alt: 'CoinPay - Non-Custodial Crypto Payment Gateway',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CoinPay - Non-Custodial Crypto Payment Gateway',
    description: 'Accept cryptocurrency payments with automatic fee handling and real-time processing',
    images: ['/banner.png'],
  },
  icons: {
    icon: [
      { url: '/icons/favicon.ico' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon-180x180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f172a' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="flex flex-col min-h-screen font-sans">
        <Providers>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-purple-600 focus:text-white focus:rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400"
          >
            Skip to content
          </a>
          <Header />
          <main id="main-content" className="flex-grow">
            {children}
          </main>
          <Footer />
        </Providers>
        <Script
          data-website-id="dfid_Bc4cBplBsTIY1hg3v3QDj"
          data-domain="coinpayportal.com"
          src="https://datafa.st/js/script.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}