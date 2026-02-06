'use client';

import { useId } from 'react';

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  symbol?: string;
  usdValue?: string;
  maxAmount?: string;
  label?: string;
  disabled?: boolean;
  error?: string | null;
}

export function AmountInput({
  value,
  onChange,
  symbol = '',
  usdValue,
  maxAmount,
  label,
  disabled = false,
  error,
}: AmountInputProps) {
  const id = useId();

  const handleChange = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    onChange(cleaned);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="0.00"
          disabled={disabled}
          className={`w-full rounded-lg border bg-white/5 px-4 py-3 pr-20 text-lg text-white placeholder-gray-500 focus:outline-none focus:ring-1 disabled:opacity-50 ${
            error
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
              : 'border-white/10 focus:border-purple-500 focus:ring-purple-500'
          }`}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {maxAmount && (
            <button
              type="button"
              onClick={() => onChange(maxAmount)}
              className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400 hover:bg-purple-500/30 transition-colors"
            >
              MAX
            </button>
          )}
          {symbol && (
            <span className="text-sm text-gray-400">{symbol}</span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        {usdValue && (
          <p className="text-xs text-gray-400">&asymp; ${usdValue} USD</p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
