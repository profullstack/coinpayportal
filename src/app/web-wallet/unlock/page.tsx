'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { PasswordInput } from '@/components/web-wallet/PasswordInput';

export default function UnlockWalletPage() {
  const router = useRouter();
  const { unlock, deleteWallet, isLoading, error, walletId } = useWebWallet();
  const [password, setPassword] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const handleUnlock = async () => {
    if (!password) return;
    const success = await unlock(password);
    if (success) {
      router.push('/web-wallet');
    }
  };

  const handleDelete = () => {
    deleteWallet();
    router.push('/web-wallet');
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-600/20">
            <svg
              className="h-8 w-8 text-purple-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Unlock Wallet</h1>
          {walletId && (
            <p className="mt-1 text-xs text-gray-500 font-mono">
              {walletId.slice(0, 8)}...{walletId.slice(-4)}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="Enter your password"
            autoFocus
          />

          <button
            onClick={handleUnlock}
            disabled={!password || isLoading}
            className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          >
            {isLoading ? 'Unlocking...' : 'Unlock'}
          </button>
        </div>

        <div className="space-y-3 pt-4 border-t border-white/10">
          <Link
            href="/web-wallet/import"
            className="block text-center text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Import different wallet
          </Link>

          {!showDelete ? (
            <button
              onClick={() => setShowDelete(true)}
              className="block w-full text-center text-sm text-red-500/50 hover:text-red-400 transition-colors"
            >
              Delete wallet from this device
            </button>
          ) : (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 space-y-3">
              <p className="text-xs text-red-400">
                This will permanently delete the encrypted wallet from this device.
                You can only recover it with your seed phrase.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDelete(false)}
                  className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm text-gray-400 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
