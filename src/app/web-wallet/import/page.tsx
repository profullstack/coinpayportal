'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { PasswordInput } from '@/components/web-wallet/PasswordInput';
import { SeedInput } from '@/components/web-wallet/SeedInput';
import { ChainMultiSelect } from '@/components/web-wallet/ChainSelector';
import { checkPasswordStrength } from '@/lib/web-wallet/client-crypto';
import { downloadEncryptedSeedPhrase } from '@/lib/web-wallet/seedphrase-backup';
import { DERIVABLE_CHAINS } from '@/lib/web-wallet/keys';

// Default to all derivable chains
const DEFAULT_CHAINS = [...DERIVABLE_CHAINS];

export default function ImportWalletPage() {
  const router = useRouter();
  const { importWallet, isLoading, error, clearError } = useWebWallet();

  const [mnemonic, setMnemonic] = useState('');
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [chains, setChains] = useState<string[]>(DEFAULT_CHAINS);
  const [seedError, setSeedError] = useState<string | null>(null);

  const words = mnemonic.split(' ').filter(Boolean);
  const passwordStrength = checkPasswordStrength(password);
  const passwordsMatch = password === confirmPassword;
  const canImport =
    words.length === wordCount &&
    password.length >= 8 &&
    passwordStrength.score >= 2 &&
    passwordsMatch &&
    chains.length > 0;

  const handleImport = async () => {
    clearError();
    setSeedError(null);

    if (words.length !== wordCount) {
      setSeedError(`Expected ${wordCount} words, got ${words.length}`);
      return;
    }

    try {
      const result = await importWallet(mnemonic.trim(), password, { chains });

      // Auto-download GPG-encrypted seed phrase backup (client-side only)
      try {
        await downloadEncryptedSeedPhrase(mnemonic.trim(), password, result.walletId);
      } catch (dlErr) {
        console.warn('Seed phrase backup download failed:', dlErr);
        // Non-fatal — user still has their phrase
      }

      router.push('/web-wallet');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('mnemonic') || message.includes('invalid')) {
        setSeedError('Invalid recovery phrase. Please check and try again.');
      }
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="mb-8">
        <Link
          href="/web-wallet"
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          &larr; Back
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-white mb-2">Import Wallet</h1>
      <p className="text-sm text-gray-400 mb-8">
        Enter your recovery phrase to restore an existing wallet.
      </p>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="space-y-6">
        {/* Word count toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setWordCount(12)}
            className={`rounded-lg px-4 py-2 text-sm transition-colors ${
              wordCount === 12
                ? 'bg-purple-600 text-white'
                : 'bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            12 words
          </button>
          <button
            type="button"
            onClick={() => setWordCount(24)}
            className={`rounded-lg px-4 py-2 text-sm transition-colors ${
              wordCount === 24
                ? 'bg-purple-600 text-white'
                : 'bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            24 words
          </button>
        </div>

        <SeedInput
          value={mnemonic}
          onChange={(val) => {
            setMnemonic(val);
            setSeedError(null);
          }}
          wordCount={wordCount}
          error={seedError}
        />

        <hr className="border-white/10" />

        <PasswordInput
          value={password}
          onChange={setPassword}
          label="Encryption Password"
          placeholder="Choose a strong password"
          showStrength
        />

        <PasswordInput
          value={confirmPassword}
          onChange={setConfirmPassword}
          label="Confirm Password"
          placeholder="Confirm your password"
        />

        {confirmPassword.length > 0 && !passwordsMatch && (
          <p className="text-xs text-red-400">Passwords do not match</p>
        )}

        <ChainMultiSelect
          value={chains}
          onChange={setChains}
          label="Select chains"
        />

        <button
          onClick={handleImport}
          disabled={!canImport || isLoading}
          className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Importing...' : 'Import Wallet'}
        </button>
      </div>
    </div>
  );
}
