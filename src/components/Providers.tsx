'use client';

import { ReactNode, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import WalletProvider with SSR disabled to avoid pino/thread-stream issues
const WalletProvider = dynamic(
  () => import('./wallet').then((mod) => mod.WalletProvider),
  { 
    ssr: false,
    loading: () => null
  }
);

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // During SSR and initial hydration, render children without wallet provider
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <WalletProvider>
      {children}
    </WalletProvider>
  );
}