'use client';

import { useState } from 'react';
import { downloadEncryptedSeedPhrase } from '@/lib/web-wallet/seedphrase-backup';

interface SeedDisplayProps {
  mnemonic: string;
  onConfirmed?: () => void;
  /** Password for GPG-encrypting the backup download */
  password?: string;
  /** Wallet ID for the backup filename */
  walletId?: string | null;
}

export function SeedDisplay({ mnemonic, onConfirmed, password, walletId }: SeedDisplayProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const words = mnemonic.split(' ');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadBackup = async () => {
    if (!password || !walletId) return;
    setDownloading(true);
    try {
      await downloadEncryptedSeedPhrase(mnemonic, password, walletId);
    } catch (err) {
      console.error('Backup download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
        <p className="text-sm font-medium text-yellow-400">
          Write down your recovery phrase
        </p>
        <p className="mt-1 text-xs text-yellow-500">
          Store it in a safe place. Anyone with this phrase can access your funds.
          Never share it with anyone.
        </p>
      </div>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-xl border border-white/10 bg-white/5 p-8 text-center hover:bg-white/10 transition-colors"
        >
          <p className="text-sm text-gray-400">Click to reveal recovery phrase</p>
        </button>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
            {words.map((word, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
              >
                <span className="text-xs text-gray-400 font-mono w-5 text-right">
                  {i + 1}.
                </span>
                <span className="text-sm text-white font-mono">{word}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>

            {password && walletId && (
              <button
                onClick={handleDownloadBackup}
                disabled={downloading}
                className="flex-1 rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-400 hover:bg-purple-500/20 hover:text-purple-300 transition-colors disabled:opacity-50"
              >
                {downloading ? 'Encrypting...' : '🔐 Download GPG Backup'}
              </button>
            )}
          </div>
        </div>
      )}

      {revealed && onConfirmed && (
        <button
          onClick={onConfirmed}
          className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
        >
          I've saved my recovery phrase
        </button>
      )}
    </div>
  );
}
