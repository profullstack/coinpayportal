'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { ChainSelector } from '@/components/web-wallet/ChainSelector';
import { AddressDisplay } from '@/components/web-wallet/AddressDisplay';
import { QRCode } from '@/components/web-wallet/QRCode';
import type { WalletChain } from '@/lib/web-wallet/identity';

const DEPOSIT_POLL_MS = 10_000; // Poll every 10 seconds
const REDIRECT_DELAY_MS = 4_000; // Show success for 4 seconds before redirect

interface WalletAddress {
  id: string;
  chain: string;
  address: string;
  index: number;
}

interface DepositDetected {
  chain: string;
  address: string;
  amount: string;
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

const CHAIN_SYMBOLS: Record<string, string> = {
  BTC: 'BTC', BCH: 'BCH', ETH: 'ETH', POL: 'POL', SOL: 'SOL',
  USDC_ETH: 'USDC', USDC_POL: 'USDC', USDC_SOL: 'USDC',
};

export default function ReceivePage() {
  const router = useRouter();
  const { wallet, chains, isUnlocked } = useWebWallet();
  const [selectedChain, setSelectedChain] = useState('');
  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeriving, setIsDeriving] = useState(false);
  const [error, setError] = useState('');
  const [deposit, setDeposit] = useState<DepositDetected | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState(0);

  // Track balances for deposit detection
  const balancesRef = useRef<Map<string, string>>(new Map());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        selectedChain ? { chain: selectedChain as WalletChain } : undefined
      );
      setAddresses(
        data.map((a) => ({
          id: a.addressId,
          chain: a.chain,
          address: a.address,
          index: a.derivationIndex ?? 0,
        }))
      );
    } catch (err) {
      console.error('Failed to fetch addresses:', err);
      setAddresses([]);
    } finally {
      setIsLoading(false);
    }
  }, [wallet, selectedChain]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  // Initialize baseline balances when addresses load
  const initializeBalances = useCallback(async () => {
    if (!wallet || addresses.length === 0) return;

    try {
      const balances = await wallet.getBalances({
        chain: selectedChain ? (selectedChain as WalletChain) : undefined,
        refresh: true,
      });

      const map = new Map<string, string>();
      for (const b of balances) {
        const key = `${b.chain}:${b.address}`;
        map.set(key, b.balance);
      }
      balancesRef.current = map;
    } catch (err) {
      console.error('Failed to initialize balances:', err);
    }
  }, [wallet, addresses, selectedChain]);

  useEffect(() => {
    initializeBalances();
  }, [initializeBalances]);

  // Poll for deposit changes
  const checkForDeposits = useCallback(async () => {
    if (!wallet || addresses.length === 0 || deposit) return;

    try {
      const balances = await wallet.getBalances({
        chain: selectedChain ? (selectedChain as WalletChain) : undefined,
        refresh: true,
      });

      for (const b of balances) {
        const key = `${b.chain}:${b.address}`;
        const previous = balancesRef.current.get(key);

        if (previous !== undefined) {
          const prevAmount = parseFloat(previous);
          const newAmount = parseFloat(b.balance);

          if (newAmount > prevAmount && newAmount > 0) {
            const depositAmount = (newAmount - prevAmount).toString();
            console.log(
              `[Receive] Deposit detected: ${depositAmount} ${b.chain} at ${b.address.slice(0, 8)}...${b.address.slice(-4)}`
            );
            setDeposit({
              chain: b.chain,
              address: b.address,
              amount: depositAmount,
            });
            return;
          }
        }

        // Update baseline
        balancesRef.current.set(key, b.balance);
      }
    } catch (err) {
      console.error('Deposit check failed:', err);
    }
  }, [wallet, addresses, selectedChain, deposit]);

  // Start/stop polling
  useEffect(() => {
    if (addresses.length === 0 || deposit) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(checkForDeposits, DEPOSIT_POLL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [addresses, checkForDeposits, deposit]);

  // Handle redirect countdown after deposit detected
  useEffect(() => {
    if (!deposit) return;

    const seconds = Math.ceil(REDIRECT_DELAY_MS / 1000);
    setRedirectCountdown(seconds);

    const countdownInterval = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const redirectTimer = setTimeout(() => {
      router.push('/web-wallet');
    }, REDIRECT_DELAY_MS);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(redirectTimer);
    };
  }, [deposit, router]);

  const handleDeriveAddress = async () => {
    if (!wallet || !selectedChain) return;
    setIsDeriving(true);
    setError('');
    try {
      await wallet.deriveAddress(selectedChain as WalletChain);
      await fetchAddresses();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to derive address');
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

        {/* Deposit detected banner */}
        {deposit && (
          <div className="mb-6 rounded-xl border border-green-500/30 bg-green-500/10 p-4 animate-pulse" role="alert">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500/20">
                <svg
                  className="h-5 w-5 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-green-400">
                  Deposit Received!
                </p>
                <p className="text-xs text-green-300/80">
                  +{deposit.amount} {CHAIN_SYMBOLS[deposit.chain] || deposit.chain}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Redirecting to dashboard in {redirectCountdown}s...
            </p>
          </div>
        )}

        {/* Polling indicator */}
        {!deposit && filteredAddresses.length > 0 && (
          <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Watching for incoming deposits...
          </div>
        )}

        <div className="space-y-6">
          <ChainSelector
            value={selectedChain}
            onChange={setSelectedChain}
            chains={chains}
            label="Filter by chain"
            disabled={!!deposit}
          />

          {/* Chain-specific warning */}
          {selectedChain && CHAIN_WARNINGS[selectedChain] && !deposit && (
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
                  className={`rounded-xl border p-4 transition-colors ${
                    deposit?.address === addr.address
                      ? 'border-green-500/30 bg-green-500/5'
                      : 'border-white/5 bg-white/5'
                  }`}
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

          {/* Derive additional address */}
          {selectedChain && filteredAddresses.length > 0 && !deposit && (
            <button
              onClick={handleDeriveAddress}
              disabled={isDeriving}
              aria-busy={isDeriving}
              className="w-full rounded-xl border border-purple-500/30 bg-purple-500/10 px-6 py-3 text-sm font-medium text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
            >
              {isDeriving
                ? 'Deriving...'
                : `Generate Additional ${selectedChain} Address`}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
