'use client';

import { useState } from 'react';

interface SeedDisplayProps {
  mnemonic: string;
  onConfirmed?: () => void;
}

export function SeedDisplay({ mnemonic, onConfirmed }: SeedDisplayProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = mnemonic.split(' ');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
        <p className="text-sm font-medium text-yellow-400">
          Write down your recovery phrase
        </p>
        <p className="mt-1 text-xs text-yellow-400/70">
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
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
            {words.map((word, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
              >
                <span className="text-xs text-gray-500 font-mono w-5 text-right">
                  {i + 1}.
                </span>
                <span className="text-sm text-white font-mono">{word}</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleCopy}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
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
