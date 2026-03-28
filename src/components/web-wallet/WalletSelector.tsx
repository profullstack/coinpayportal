'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useWebWallet } from './WalletContext';

export function WalletSelector() {
  const { activeWalletId, wallets, switchWallet, updateWalletLabel } =
    useWebWallet();

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeWallet = wallets.find((w) => w.id === activeWalletId);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setEditingId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5 transition-colors"
      >
        <span className="text-purple-400">🔑</span>
        <span className="font-medium text-white truncate max-w-[160px]">
          {activeWallet?.label || 'Wallet'}
        </span>
        <svg
          className={`h-3 w-3 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 rounded-xl border border-white/10 bg-slate-800 shadow-xl z-50 overflow-hidden">
          {wallets.map((wallet) => (
            <div
              key={wallet.id}
              className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                wallet.id === activeWalletId
                  ? 'bg-purple-600/20 border-l-2 border-purple-500'
                  : 'hover:bg-white/5 border-l-2 border-transparent'
              }`}
              onClick={() => {
                if (editingId !== wallet.id) {
                  switchWallet(wallet.id);
                  setIsOpen(false);
                }
              }}
            >
              <div className="flex-1 min-w-0">
                {editingId === wallet.id ? (
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateWalletLabel(wallet.id, editLabel);
                        setEditingId(null);
                      }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => {
                      if (editLabel.trim()) {
                        updateWalletLabel(wallet.id, editLabel.trim());
                      }
                      setEditingId(null);
                    }}
                    autoFocus
                    className="w-full bg-transparent text-sm text-white border-b border-purple-500 outline-none py-0.5"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">
                      {wallet.label}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(wallet.id);
                        setEditLabel(wallet.label);
                      }}
                      className="text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Edit label"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                    </button>
                  </div>
                )}
                <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                  {wallet.id.slice(0, 8)}...{wallet.id.slice(-4)}
                </p>
              </div>
              {wallet.id === activeWalletId && (
                <span className="text-xs text-purple-400 flex-shrink-0">
                  Active
                </span>
              )}
            </div>
          ))}

          <div className="border-t border-white/10">
            <Link
              href="/web-wallet/create"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span>+</span> Create New Wallet
            </Link>
            <Link
              href="/web-wallet/import"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span>↓</span> Import Wallet
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
