'use client';

import { useState, useEffect } from 'react';

interface LightningAddressProps {
  walletId: string;
}

export function LightningAddress({ walletId }: LightningAddressProps) {
  const [username, setUsername] = useState('');
  const [currentAddress, setCurrentAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Check existing Lightning Address
  useEffect(() => {
    fetch(`/api/lightning/address?wallet_id=${walletId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.lightning_address) {
          setCurrentAddress(data.lightning_address);
          setUsername(data.username || '');
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [walletId]);

  const handleRegister = async () => {
    if (!username.trim()) {
      setMessage({ type: 'error', text: 'Enter a username' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch('/api/lightning/address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_id: walletId, username: username.trim().toLowerCase() }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCurrentAddress(data.lightning_address);
        setMessage({ type: 'success', text: 'Lightning Address registered!' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to register' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = () => {
    if (currentAddress) {
      navigator.clipboard.writeText(currentAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (checking) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">⚡</span>
        <h3 className="text-sm font-semibold text-white">Lightning Address</h3>
      </div>

      {currentAddress ? (
        <div className="space-y-2">
          <div
            className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-3 py-2 cursor-pointer hover:bg-white/10 transition-colors"
            onClick={copyAddress}
          >
            <span className="text-sm font-mono text-amber-400">{currentAddress}</span>
            <span className="text-xs text-gray-500">
              {copied ? '✓ Copied' : 'Click to copy'}
            </span>
          </div>
          <p className="text-xs text-gray-500">
            Anyone can send you sats using this address from any Lightning wallet.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Get a Lightning Address so anyone can send you sats — like an email for Bitcoin.
          </p>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                placeholder="username"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-amber-500/50 focus:outline-none pr-[140px]"
                maxLength={32}
                disabled={loading}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                @coinpayportal.com
              </span>
            </div>
          </div>
          <button
            onClick={handleRegister}
            disabled={loading || !username.trim()}
            className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Registering...' : 'Claim Lightning Address'}
          </button>
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
