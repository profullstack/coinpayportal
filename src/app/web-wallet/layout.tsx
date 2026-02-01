'use client';

import { WebWalletProvider } from '@/components/web-wallet/WalletContext';

export default function WebWalletLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WebWalletProvider>{children}</WebWalletProvider>;
}
