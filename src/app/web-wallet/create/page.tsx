'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { PasswordInput } from '@/components/web-wallet/PasswordInput';
import { SeedDisplay } from '@/components/web-wallet/SeedDisplay';
import { ChainMultiSelect } from '@/components/web-wallet/ChainSelector';
import { checkPasswordStrength } from '@/lib/web-wallet/client-crypto';
import { downloadEncryptedSeedPhrase } from '@/lib/web-wallet/seedphrase-backup';
import { DERIVABLE_CHAINS } from '@/lib/web-wallet/keys';

type Step = 'password' | 'seed' | 'verify';

// Default to all derivable chains
const DEFAULT_CHAINS = [...DERIVABLE_CHAINS];

export default function CreateWalletPage() {
  const router = useRouter();
  const { createWallet, isLoading, error, clearError, walletId: contextWalletId } = useWebWallet();

  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [chains, setChains] = useState<string[]>(DEFAULT_CHAINS);
  const [mnemonic, setMnemonic] = useState('');
  const [verifyWord, setVerifyWord] = useState('');
  const [verifyIndex, setVerifyIndex] = useState(0);
  const [verifyError, setVerifyError] = useState('');

  const passwordStrength = checkPasswordStrength(password);
  const passwordsMatch = password === confirmPassword;
  const canProceed =
    password.length >= 8 &&
    passwordStrength.score >= 2 &&
    passwordsMatch &&
    chains.length > 0;

  const handleCreateWallet = async () => {
    clearError();
    try {
      const result = await createWallet(password, { chains });
      setMnemonic(result.mnemonic);

      // Auto-download GPG-encrypted seed phrase backup (client-side only)
      try {
        await downloadEncryptedSeedPhrase(result.mnemonic, password, result.walletId);
      } catch (dlErr) {
        console.warn('Seed phrase backup download failed:', dlErr);
        // Non-fatal — user can still copy manually
      }

      // Pick a random word index for verification
      const words = result.mnemonic.split(' ');
      setVerifyIndex(Math.floor(Math.random() * words.length));
      setStep('seed');
    } catch (err) {
      console.error('Failed to create wallet:', err);
      // Error is also set via context for UI display
    }
  };

  const handleSeedConfirmed = () => {
    setStep('verify');
  };

  const handleVerify = () => {
    const words = mnemonic.split(' ');
    if (verifyWord.toLowerCase().trim() === words[verifyIndex]) {
      router.push('/web-wallet');
    } else {
      setVerifyError(`Incorrect. Please check word #${verifyIndex + 1}.`);
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

      <h1 className="text-2xl font-bold text-white mb-2">Create New Wallet</h1>
      <p className="text-sm text-gray-400 mb-8">
        {step === 'password' && 'Choose a strong password to encrypt your wallet.'}
        {step === 'seed' && 'Save your recovery phrase — it\'s the only way to recover your wallet.'}
        {step === 'verify' && 'Verify you saved your recovery phrase correctly.'}
      </p>

      {/* Progress */}
      <div className="mb-8 flex gap-2">
        {(['password', 'seed', 'verify'] as const).map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= ['password', 'seed', 'verify'].indexOf(step)
                ? 'bg-purple-500'
                : 'bg-white/10'
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {step === 'password' && (
        <div className="space-y-6">
          <PasswordInput
            value={password}
            onChange={setPassword}
            label="Password"
            placeholder="Choose a strong password"
            showStrength
            autoFocus
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
            onClick={handleCreateWallet}
            disabled={!canProceed || isLoading}
            className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Creating...' : 'Create Wallet'}
          </button>
        </div>
      )}

      {step === 'seed' && mnemonic && (
        <SeedDisplay
          mnemonic={mnemonic}
          onConfirmed={handleSeedConfirmed}
          password={password}
          walletId={contextWalletId}
        />
      )}

      {step === 'verify' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-gray-300 mb-4">
              What is word <span className="font-bold text-white">#{verifyIndex + 1}</span> of
              your recovery phrase?
            </p>
            <input
              type="text"
              value={verifyWord}
              onChange={(e) => {
                setVerifyWord(e.target.value);
                setVerifyError('');
              }}
              placeholder="Enter word..."
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-gray-500 font-mono focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              autoComplete="off"
              spellCheck={false}
            />
            {verifyError && (
              <p className="mt-2 text-xs text-red-400">{verifyError}</p>
            )}
          </div>

          <button
            onClick={handleVerify}
            disabled={!verifyWord.trim()}
            className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Verify & Continue
          </button>

          <button
            onClick={() => setStep('seed')}
            className="w-full rounded-lg bg-white/5 px-6 py-3 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            Show recovery phrase again
          </button>
        </div>
      )}
    </div>
  );
}
