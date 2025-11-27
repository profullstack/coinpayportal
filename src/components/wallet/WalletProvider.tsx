'use client';

import { ReactNode } from 'react';
import { EVMProvider } from './EVMProvider';
import { SolanaProvider } from './SolanaProvider';
import { State } from 'wagmi';

interface WalletProviderProps {
  children: ReactNode;
  initialState?: State;
}

export function WalletProvider({ children, initialState }: WalletProviderProps) {
  return (
    <EVMProvider initialState={initialState}>
      <SolanaProvider>
        {children}
      </SolanaProvider>
    </EVMProvider>
  );
}