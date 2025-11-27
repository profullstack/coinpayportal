'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, State } from 'wagmi';
import { wagmiConfig, projectId, metadata } from '@/lib/wallet/config';
import { ReactNode, useState, useEffect } from 'react';
import { createAppKit } from '@reown/appkit/react';
import { mainnet, polygon, sepolia, polygonAmoy } from '@reown/appkit/networks';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';

// Create wagmi adapter for AppKit
const wagmiAdapter = new WagmiAdapter({
  networks: [mainnet, polygon, sepolia, polygonAmoy],
  projectId,
  ssr: true,
});

// Initialize AppKit only on client side
let appKitInitialized = false;

function initializeAppKit() {
  if (typeof window === 'undefined' || appKitInitialized || !projectId) return;
  
  try {
    createAppKit({
      adapters: [wagmiAdapter],
      networks: [mainnet, polygon, sepolia, polygonAmoy],
      projectId,
      metadata,
      features: {
        analytics: true,
        email: false,
        socials: false,
      },
      themeMode: 'dark',
      themeVariables: {
        '--w3m-accent': '#a855f7',
        '--w3m-border-radius-master': '12px',
      },
    });
    appKitInitialized = true;
  } catch (error) {
    console.error('Failed to initialize AppKit:', error);
  }
}

interface EVMProviderProps {
  children: ReactNode;
  initialState?: State;
}

export function EVMProvider({ children, initialState }: EVMProviderProps) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        gcTime: 5 * 60 * 1000, // 5 minutes
      },
    },
  }));

  useEffect(() => {
    initializeAppKit();
  }, []);

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}