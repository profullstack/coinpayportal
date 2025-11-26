import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CoinPayPortal - Non-Custodial Crypto Payment Gateway',
  description: 'Accept cryptocurrency payments in your e-commerce store with automatic fee handling and real-time processing',
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