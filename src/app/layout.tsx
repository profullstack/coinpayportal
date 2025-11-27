import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
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
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CoinPay - Non-Custodial Crypto Payment Gateway',
    description: 'Accept cryptocurrency payments with automatic fee handling and real-time processing',
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
      <body className="flex flex-col min-h-screen">
        <Providers>
          <Header />
          <main className="flex-grow">
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