'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

const CHAINS = [
  { value: 'BTC', label: 'Bitcoin (BTC)' },
  { value: 'BCH', label: 'Bitcoin Cash (BCH)' },
  { value: 'ETH', label: 'Ethereum (ETH)' },
  { value: 'POL', label: 'Polygon (POL)' },
  { value: 'SOL', label: 'Solana (SOL)' },
  { value: 'DOGE', label: 'Dogecoin (DOGE)' },
  { value: 'XRP', label: 'Ripple (XRP)' },
  { value: 'ADA', label: 'Cardano (ADA)' },
  { value: 'BNB', label: 'BNB Chain (BNB)' },
  { value: 'USDT', label: 'Tether (USDT)' },
  { value: 'USDC', label: 'USD Coin (USDC)' },
  { value: 'USDC_ETH', label: 'USDC (Ethereum)' },
  { value: 'USDC_POL', label: 'USDC (Polygon) — Low Fees' },
  { value: 'USDC_SOL', label: 'USDC (Solana) — Low Fees' },
];

const EXPIRY_OPTIONS = [
  { value: 24, label: '24 hours' },
  { value: 48, label: '48 hours' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
  { value: 336, label: '14 days' },
  { value: 720, label: '30 days' },
];

interface Business {
  id: string;
  name: string;
}

interface CreatedEscrow {
  id: string;
  escrow_address: string;
  depositor_address: string;
  beneficiary_address: string;
  chain: string;
  amount: number;
  amount_usd: number | null;
  fee_amount: number | null;
  deposited_amount: number | null;
  status: string;
  release_token: string;
  beneficiary_token: string;
  expires_at: string;
  created_at: string;
  metadata: Record<string, unknown>;
  business_id: string | null;
}

export default function CreateEscrowPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdEscrow, setCreatedEscrow] = useState<CreatedEscrow | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [formData, setFormData] = useState({
    chain: 'USDC_POL',
    amount: '',
    depositor_address: '',
    beneficiary_address: '',
    arbiter_address: '',
    description: '',
    expires_in_hours: 168,
    business_id: '',
  });

  // Check if user is logged in and fetch their businesses
  const fetchBusinesses = useCallback(async () => {
    try {
      const result = await authFetch('/api/businesses', {});
      if (result && result.response.ok && result.data.success) {
        setBusinesses(result.data.businesses || []);
        setIsLoggedIn(true);
        if (result.data.businesses?.length > 0) {
          setFormData(prev => ({ ...prev, business_id: result.data.businesses[0].id }));
        }
      }
    } catch {
      // Not logged in — that's fine, escrow works anonymously
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);

    try {
      const body: Record<string, unknown> = {
        chain: formData.chain,
        amount: parseFloat(formData.amount),
        depositor_address: formData.depositor_address.trim(),
        beneficiary_address: formData.beneficiary_address.trim(),
        expires_in_hours: formData.expires_in_hours,
      };

      if (formData.arbiter_address.trim()) {
        body.arbiter_address = formData.arbiter_address.trim();
      }
      if (formData.description.trim()) {
        body.metadata = { description: formData.description.trim() };
      }
      // Associate with business if logged in
      if (formData.business_id) {
        body.business_id = formData.business_id;
      }

      // Use authFetch to include credentials (for logged-in merchants)
      const result = await authFetch('/api/escrow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (result && result.response.ok) {
        setCreatedEscrow(result.data);
      } else if (result) {
        setError(result.data?.error || 'Failed to create escrow');
      } else {
        // authFetch returned null (redirect to login) — try anonymous
        const res = await fetch('/api/escrow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          setError(errData?.error || `Failed to create escrow (${res.status})`);
        } else {
          setCreatedEscrow(await res.json());
        }
      }
    } catch (err) {
      setError('Failed to create escrow. Please try again.');
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  // ── Success view ──────────────────────────────────────
  if (createdEscrow) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="bg-green-50 dark:bg-green-900/30 px-6 py-4 border-b border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2">
              <svg className="h-6 w-6 text-green-600" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-lg font-semibold text-green-900 dark:text-green-300">
                Escrow Created!
              </h2>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Escrow deposit address */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Deposit Address
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Send exactly <strong>{createdEscrow.amount} {createdEscrow.chain}</strong> to this address to fund the escrow.
              </p>
              <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between gap-3">
                <code className="text-sm text-gray-900 dark:text-white break-all flex-1">
                  {createdEscrow.escrow_address}
                </code>
                <button
                  onClick={() => copyToClipboard(createdEscrow.escrow_address, 'address')}
                  className="flex-shrink-0 p-2 text-gray-500 hover:text-blue-600 rounded-lg transition-colors"
                >
                  {copiedField === 'address' ? '✓' : '📋'}
                </button>
              </div>
            </div>

            {/* Amount + Chain */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</h3>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {createdEscrow.amount} {createdEscrow.chain}
                </p>
                {createdEscrow.amount_usd && (
                  <p className="text-sm text-gray-500">≈ ${createdEscrow.amount_usd.toFixed(2)}</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</h3>
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                  {createdEscrow.status}
                </span>
              </div>
            </div>

            {/* Tokens — CRITICAL section */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-4">
              <div className="flex items-start gap-2">
                <span className="text-amber-600 text-lg">⚠️</span>
                <div>
                  <h3 className="font-semibold text-amber-900 dark:text-amber-300">Save These Tokens!</h3>
                  <p className="text-sm text-amber-800 dark:text-amber-400">
                    These tokens are shown <strong>only once</strong>. They are needed to release or claim the escrow funds.
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-amber-800 dark:text-amber-400 uppercase tracking-wide">
                  Release Token (for depositor)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 text-xs break-all text-gray-900 dark:text-white">
                    {createdEscrow.release_token}
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdEscrow.release_token, 'release')}
                    className="flex-shrink-0 px-3 py-2 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700 transition-colors"
                  >
                    {copiedField === 'release' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-amber-800 dark:text-amber-400 uppercase tracking-wide">
                  Beneficiary Token (for recipient)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 text-xs break-all text-gray-900 dark:text-white">
                    {createdEscrow.beneficiary_token}
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdEscrow.beneficiary_token, 'beneficiary')}
                    className="flex-shrink-0 px-3 py-2 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700 transition-colors"
                  >
                    {copiedField === 'beneficiary' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            {/* Addresses */}
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Depositor:</span>
                <code className="ml-2 text-gray-900 dark:text-white break-all">{createdEscrow.depositor_address}</code>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Beneficiary:</span>
                <code className="ml-2 text-gray-900 dark:text-white break-all">{createdEscrow.beneficiary_address}</code>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Expires:</span>
                <span className="ml-2 text-gray-900 dark:text-white">
                  {new Date(createdEscrow.expires_at).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Escrow ID:</span>
                <code className="ml-2 text-gray-900 dark:text-white">{createdEscrow.id}</code>
              </div>
              {createdEscrow.fee_amount && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Platform Fee:</span>
                  <span className="ml-2 text-gray-900 dark:text-white">
                    {createdEscrow.fee_amount} {createdEscrow.chain}
                    {createdEscrow.business_id && <span className="text-green-600 ml-1">(paid tier rate)</span>}
                  </span>
                </div>
              )}
              {createdEscrow.business_id && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Business:</span>
                  <span className="ml-2 text-gray-900 dark:text-white">
                    {businesses.find(b => b.id === createdEscrow.business_id)?.name || createdEscrow.business_id}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <Link
                href="/escrow"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                ← Back to Escrows
              </Link>
              <button
                onClick={() => {
                  setCreatedEscrow(null);
                  setFormData(prev => ({
                    ...prev,
                    amount: '',
                    depositor_address: '',
                    beneficiary_address: '',
                    arbiter_address: '',
                    description: '',
                  }));
                }}
                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Form view ─────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href="/escrow" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          ← Back to Escrows
        </Link>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Create Escrow</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Lock crypto in escrow for trustless transactions between parties
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Business selector (logged-in merchants only) */}
          {!loadingAuth && isLoggedIn && businesses.length > 0 && (
            <div>
              <label htmlFor="business" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Business
              </label>
              <select
                id="business"
                value={formData.business_id}
                onChange={(e) => setFormData({ ...formData, business_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">No business (anonymous)</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                ✓ Linked to your business — paid tier fee rate (0.5%) applies
              </p>
            </div>
          )}

          {!loadingAuth && !isLoggedIn && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
              <Link href="/login" className="font-medium underline hover:text-blue-900">Log in</Link> to associate this escrow with your business and get reduced fees (0.5% vs 1%).
            </div>
          )}

          {/* Chain */}
          <div>
            <label htmlFor="chain" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Cryptocurrency *
            </label>
            <select
              id="chain"
              required
              value={formData.chain}
              onChange={(e) => setFormData({ ...formData, chain: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              {CHAINS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Amount ({formData.chain}) *
            </label>
            <input
              id="amount"
              type="number"
              step="any"
              min="0.000001"
              required
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              placeholder="0.00"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Amount in crypto (not USD). The depositor sends exactly this amount.
            </p>
          </div>

          {/* Depositor Address */}
          <div>
            <label htmlFor="depositor" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Depositor Address *
            </label>
            <input
              id="depositor"
              type="text"
              required
              value={formData.depositor_address}
              onChange={(e) => setFormData({ ...formData, depositor_address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
              placeholder="Your wallet address (sender)"
            />
          </div>

          {/* Beneficiary Address */}
          <div>
            <label htmlFor="beneficiary" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Beneficiary Address *
            </label>
            <input
              id="beneficiary"
              type="text"
              required
              value={formData.beneficiary_address}
              onChange={(e) => setFormData({ ...formData, beneficiary_address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
              placeholder="Recipient wallet address"
            />
          </div>

          {/* Arbiter Address (optional) */}
          <div>
            <label htmlFor="arbiter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Arbiter Address <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="arbiter"
              type="text"
              value={formData.arbiter_address}
              onChange={(e) => setFormData({ ...formData, arbiter_address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
              placeholder="Third-party dispute resolver (optional)"
            />
          </div>

          {/* Expiry */}
          <div>
            <label htmlFor="expires" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Expiry
            </label>
            <select
              id="expires"
              value={formData.expires_in_hours}
              onChange={(e) => setFormData({ ...formData, expires_in_hours: parseInt(e.target.value) })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              placeholder="What is this escrow for? (e.g., freelance job, NFT trade)"
              rows={3}
            />
          </div>

          {/* Info box */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 rounded-lg text-sm text-blue-800 dark:text-blue-300 space-y-2">
            <p><strong>How it works:</strong></p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700 dark:text-blue-400">
              <li>You create the escrow — we generate a deposit address</li>
              <li>Depositor sends crypto to the escrow address</li>
              <li>Once funded, depositor can release funds to the beneficiary</li>
              <li>If there&apos;s a dispute, the arbiter (or platform) resolves it</li>
            </ol>
            <p className="text-xs text-blue-600 dark:text-blue-500 mt-2">
              Platform fee: {isLoggedIn && formData.business_id ? '0.5% (paid tier)' : '1% (0.5% for logged-in merchants)'}. No fee on refunds.
            </p>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between pt-4">
            <Link
              href="/escrow"
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={creating}
              className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? 'Creating...' : 'Create Escrow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
