'use client';

import { useState, useCallback } from 'react';

interface SeedInputProps {
  value: string;
  onChange: (value: string) => void;
  wordCount?: 12 | 24;
  error?: string | null;
}

export function SeedInput({
  value,
  onChange,
  wordCount = 12,
  error,
}: SeedInputProps) {
  const [mode, setMode] = useState<'paste' | 'grid'>('paste');
  const words = value.split(' ').filter(Boolean);

  const handlePasteChange = useCallback(
    (text: string) => {
      const cleaned = text
        .toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      onChange(cleaned);
    },
    [onChange]
  );

  const handleWordChange = useCallback(
    (index: number, word: string) => {
      const current = value.split(' ');
      while (current.length < wordCount) current.push('');
      current[index] = word.toLowerCase().replace(/[^a-z]/g, '');
      onChange(current.join(' ').trim());
    },
    [value, onChange, wordCount]
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('paste')}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            mode === 'paste'
              ? 'bg-purple-600 text-white'
              : 'bg-white/5 text-gray-400 hover:text-white'
          }`}
        >
          Paste
        </button>
        <button
          type="button"
          onClick={() => setMode('grid')}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            mode === 'grid'
              ? 'bg-purple-600 text-white'
              : 'bg-white/5 text-gray-400 hover:text-white'
          }`}
        >
          Word by word
        </button>
      </div>

      {mode === 'paste' ? (
        <textarea
          value={value}
          onChange={(e) => handlePasteChange(e.target.value)}
          placeholder={`Enter your ${wordCount}-word recovery phrase...`}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-gray-500 font-mono text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 min-h-[100px] resize-none"
          autoComplete="off"
          spellCheck={false}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: wordCount }).map((_, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-xs text-gray-400 font-mono w-5 text-right">
                {i + 1}.
              </span>
              <input
                type="text"
                value={words[i] || ''}
                onChange={(e) => handleWordChange(i, e.target.value)}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white font-mono placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {words.length} / {wordCount} words
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
