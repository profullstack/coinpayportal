'use client';

import { ReactNode } from 'react';
import { WalletProvider } from './wallet';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <WalletProvider>
      {children}
    </WalletProvider>
  );
}