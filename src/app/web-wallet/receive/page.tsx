'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { ChainSelector } from '@/components/web-wallet/ChainSelector';
import { AddressDisplay } from '@/components/web-wallet/AddressDisplay';
import { QRCode } from '@/components/web-wallet/QRCode';

interface WalletAddress {
  id: string;
  chain: string;
  address: string;
  index: number;
}

const CHAIN_WARNINGS: Record<string, string> = {
  BTC: 'Only send Bitcoin (BTC) to this address. Sending other assets will result in permanent loss.',
  BCH: 'Only send Bitcoin Cash (BCH) to this address. BTC and BCH addresses may look similar but are not compatible.',
  ETH: 'Only send Ethereum (ETH) or ERC-20 tokens to this address.',
  POL: 'Only send Polygon (POL) or tokens on the Polygon network to this address. Do not send assets from other networks.',
  SOL: 'Only send Solana (SOL) or SPL tokens to this address.',
  USDC_ETH: 'Only send USDC on Ethereum to this address. USDC on other networks is not compatible.',
  USDC_POL: 'Only send USDC on Polygon to this address. USDC on other networks is not compatible.',
  USDC_SOL: 'Only send USDC on Solana to this address. USDC on other networks is not compatible.',
};

export default function ReceivePage() {
  const router = useRouter();
  const { wallet, chains, isUnlocked } = useWebWallet();
  const [selectedChain, setSelectedChain] = useState('');
  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeriving, setIsDeriving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [isUnlocked, router]);

  const fetchAddresses = useCallback(async () => {
    if (!wallet) return;
    setIsLoading(true);
    try {
      const data = await wallet.getAddresses(
        selectedChain ? { chain: selectedChain as any } : undefined
      );
      setAddresses(
        data.map((a: any) => ({
          id: a.id,
          chain: a.chain,
          address: a.address,
          index: a.derivation_index ?? a.index ?? 0,
        }))
      );
    } catch {
      setAddresses([]);
    } finally {
      setIsLoading(false);
    }
  }, [wallet, selectedChain]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const handleDeriveAddress = async () => {
    if (!wallet || !selectedChain) return;
    setIsDeriving(true);
    setError('');
    try {
      await wallet.deriveAddress(selectedChain as any);
      await fetchAddresses();
    } catch (err: any) {
      setError(err.message || 'Failed to derive address');
    } finally {
      setIsDeriving(false);
    }
  };

  const filteredAddresses = selectedChain
    ? addresses.filter((a) => a.chain === selectedChain)
    : addresses;

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <Link
            href="/web-wallet"
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            &larr; Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">Receive</h1>
          <p className="mt-1 text-sm text-gray-400">
            Share your address to receive crypto
          </p>
        </div>

        <div className="space-y-6">
          <ChainSelector
            value={selectedChain}
            onChange={setSelectedChain}
            chains={chains}
            label="Filter by chain"
          />

          {/* Chain-specific warning */}
          {selectedChain && CHAIN_WARNINGS[selectedChain] && (
            <div
              className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3"
              role="alert"
            >
              <p className="text-xs text-yellow-400">
                {CHAIN_WARNINGS[selectedChain]}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Address list */}
          {isLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading addresses">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/5 bg-white/5 p-4 animate-pulse"
                >
                  <div className="h-4 w-24 rounded bg-white/10 mb-2" />
                  <div className="h-5 w-full rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : filteredAddresses.length > 0 ? (
            <div className="space-y-3">
              {filteredAddresses.map((addr) => (
                <div
                  key={addr.id}
                  className="rounded-xl border border-white/5 bg-white/5 p-4"
                >
                  <AddressDisplay
                    address={addr.address}
                    chain={addr.chain}
                    label={`Index ${addr.index}`}
                    truncate={false}
                  />

                  {/* QR Code */}
                  <div className="mt-3 flex items-center justify-center">
                    <QRCode
                      value={addr.address}
                      size={180}
                      label={`${addr.chain} address`}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-white/5 bg-white/5 p-8 text-center">
              <p className="text-sm text-gray-400">
                {selectedChain
                  ? `No ${selectedChain} addresses yet`
                  : 'No addresses yet'}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Derive an address to get started
              </p>
            </div>
          )}

          {/* Derive new address */}
          {selectedChain && (
            <button
              onClick={handleDeriveAddress}
              disabled={isDeriving}
              aria-busy={isDeriving}
              className="w-full rounded-xl border border-purple-500/30 bg-purple-500/10 px-6 py-3 text-sm font-medium text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
            >
              {isDeriving
                ? 'Deriving...'
                : `Derive New ${selectedChain} Address`}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
