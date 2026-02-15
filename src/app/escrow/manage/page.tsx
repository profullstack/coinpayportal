'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { EscrowPublic, EscrowEvent } from '@/lib/escrow/types';

interface AuthenticatedEscrowData {
  escrow: EscrowPublic;
  role: 'depositor' | 'beneficiary' | 'arbiter';
}

const STATUS_COLORS: Record<string, string> = {
  created: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  pending_deposit: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  funded: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  released: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  settled: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  disputed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  refunded: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  expired: 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-500',
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  created: 'Awaiting deposit from depositor',
  pending_deposit: 'Awaiting deposit from depositor',
  funded: 'Escrowed funds ready for release',
  released: 'Funds released, awaiting blockchain settlement',
  settled: 'Transaction completed successfully',
  disputed: 'Dispute raised, awaiting resolution',
  refunded: 'Funds returned to depositor',
  expired: 'Escrow expired before funding',
};

function StatusBadge({ status }: { status: string }) {
  const statusDisplay = status === 'pending' ? 'pending_deposit' : status;
  return (
    <div className="text-center">
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}`}>
        {statusDisplay.replace('_', ' ')}
      </span>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {STATUS_DESCRIPTIONS[status] || status}
      </p>
    </div>
  );
}

function shortenAddress(addr: string, chars = 6): string {
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EscrowManagePageWrapper() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl mx-auto px-4 py-8 text-center">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    }>
      <EscrowManagePage />
    </Suspense>
  );
}

function EscrowManagePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [escrowId, setEscrowId] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authenticatedData, setAuthenticatedData] = useState<AuthenticatedEscrowData | null>(null);
  const [events, setEvents] = useState<EscrowEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Load URL params on component mount
  useEffect(() => {
    const id = searchParams?.get('id');
    const tokenParam = searchParams?.get('token');
    if (id) setEscrowId(id);
    if (tokenParam) setToken(tokenParam);

    // Auto-authenticate if both params are present
    if (id && tokenParam) {
      authenticate(id, tokenParam);
    }
  }, [searchParams]);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const authenticate = async (id?: string, tokenValue?: string) => {
    const currentId = id || escrowId;
    const currentToken = tokenValue || token;

    if (!currentId || !currentToken) {
      setError('Please enter both Escrow ID and Token');
      return;
    }

    setLoading(true);
    setError('');
    setAuthenticatedData(null);

    try {
      const response = await fetch(`/api/escrow/${currentId}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Authentication failed');
        return;
      }

      const data = await response.json();
      setAuthenticatedData(data);
      fetchEvents(currentId);

      // Update URL without triggering a page reload
      const url = new URL(window.location.href);
      url.searchParams.set('id', currentId);
      url.searchParams.set('token', currentToken);
      window.history.replaceState({}, '', url);
    } catch (err) {
      setError('Failed to authenticate. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEvents = async (escrowId: string) => {
    try {
      setEventsLoading(true);
      const response = await fetch(`/api/escrow/${escrowId}/events`);
      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setEventsLoading(false);
    }
  };

  const performAction = async (action: 'release' | 'refund', actionToken?: string) => {
    if (!authenticatedData) return;

    setActionLoading(action);
    setError('');

    try {
      const response = await fetch(`/api/escrow/${authenticatedData.escrow.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          [action === 'release' ? 'release_token' : 'release_token']: actionToken || token 
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || `Failed to ${action} escrow`);
        return;
      }

      const updatedEscrow = await response.json();
      setAuthenticatedData({
        ...authenticatedData,
        escrow: updatedEscrow,
      });
      fetchEvents(authenticatedData.escrow.id);
    } catch (err) {
      setError(`Failed to ${action} escrow. Please try again.`);
      console.error(err);
    } finally {
      setActionLoading('');
    }
  };

  const submitDispute = async () => {
    if (!authenticatedData) return;

    if (!disputeReason || disputeReason.trim().length < 10) {
      setError('Dispute reason must be at least 10 characters');
      return;
    }

    setActionLoading('dispute');
    setError('');

    try {
      const response = await fetch(`/api/escrow/${authenticatedData.escrow.id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token,
          reason: disputeReason.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to file dispute');
        return;
      }

      const updatedEscrow = await response.json();
      setAuthenticatedData({
        ...authenticatedData,
        escrow: updatedEscrow,
      });
      fetchEvents(authenticatedData.escrow.id);
      setShowDispute(false);
      setDisputeReason('');
    } catch (err) {
      setError('Failed to file dispute. Please try again.');
      console.error(err);
    } finally {
      setActionLoading('');
    }
  };

  // If not authenticated, show the login form
  if (!authenticatedData) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Manage Escrow</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Enter your Escrow ID and Token to access your escrow
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
          <form onSubmit={(e) => { e.preventDefault(); authenticate(); }} className="space-y-6">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="escrowId" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Escrow ID *
              </label>
              <input
                id="escrowId"
                type="text"
                required
                value={escrowId}
                onChange={(e) => setEscrowId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
                placeholder="esc_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>

            <div>
              <label htmlFor="token" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Access Token *
              </label>
              <input
                id="token"
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
                placeholder="esc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Use your release token (depositor) or beneficiary token (recipient)
              </p>
            </div>

            <div className="flex items-center justify-between pt-4">
              <Link
                href="/escrow"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                ← Back to Escrows
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Authenticating...' : 'Access Escrow'}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-8 text-center">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-300">
            <p className="font-medium mb-2">How to access your escrow:</p>
            <ul className="text-left space-y-1 text-blue-700 dark:text-blue-400">
              <li>• <strong>Depositor:</strong> Use your release token to release funds or request refunds</li>
              <li>• <strong>Recipient:</strong> Use your beneficiary token to view status and file disputes</li>
              <li>• Tokens are provided when the escrow is created</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const { escrow, role } = authenticatedData;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Escrow Management</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Managing as <span className="font-medium capitalize text-gray-700 dark:text-gray-300">{role}</span>
          </p>
        </div>
        <Link
          href="/escrow"
          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
        >
          ← All Escrows
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Escrow Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Status */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Status</h2>
            <StatusBadge status={escrow.status} />
          </div>

          {/* Escrow Information */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Escrow Details</h2>
              <button
                onClick={() => {
                  const info = [
                    `Escrow ID: ${escrow.id}`,
                    `Payment Address: ${escrow.escrow_address}`,
                    `Amount: ${escrow.amount} ${escrow.chain}`,
                    `Chain: ${escrow.chain}`,
                    `Status: ${escrow.status}`,
                    `Created: ${formatDate(escrow.created_at)}`,
                    `Expires: ${formatDate(escrow.expires_at)}`,
                    `Depositor: ${escrow.depositor_address}`,
                    `Beneficiary: ${escrow.beneficiary_address}`,
                    ...(escrow.amount_usd ? [`USD Value: $${escrow.amount_usd.toFixed(2)}`] : []),
                    ...(escrow.deposit_tx_hash ? [`Deposit TX: ${escrow.deposit_tx_hash}`] : []),
                    ...(escrow.settlement_tx_hash ? [`Settlement TX: ${escrow.settlement_tx_hash}`] : []),
                  ].join('\n');
                  copyToClipboard(info, 'all_info');
                }}
                className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                {copiedField === 'all_info' ? '✓ Copied!' : '📋 Copy All Info'}
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Amount</h3>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {escrow.amount} {escrow.chain}
                </p>
                {escrow.amount_usd && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    ≈ ${escrow.amount_usd.toFixed(2)} USD
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Chain</h3>
                <p className="text-lg font-medium text-gray-900 dark:text-white">{escrow.chain}</p>
              </div>

              <div className="md:col-span-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Escrow Address</h3>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs text-gray-900 dark:text-white break-all">
                    {escrow.escrow_address}
                  </code>
                  <button
                    onClick={() => copyToClipboard(escrow.escrow_address, 'address')}
                    className="p-2 text-gray-500 hover:text-blue-600 rounded transition-colors"
                  >
                    {copiedField === 'address' ? '✓' : '📋'}
                  </button>
                </div>
                {escrow.status === 'pending' && role === 'depositor' && (
                  <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded">
                    <p className="text-sm text-amber-800 dark:text-amber-400">
                      <strong>Send exactly {escrow.amount} {escrow.chain}</strong> to this address to fund the escrow.
                    </p>
                    <button
                      onClick={() => copyToClipboard(`${escrow.amount}`, 'amount')}
                      className="mt-2 text-xs text-amber-600 hover:text-amber-800 underline"
                    >
                      {copiedField === 'amount' ? 'Amount copied!' : 'Copy amount'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 mt-6 pt-6 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Depositor Address</h3>
                <code className="text-sm text-gray-900 dark:text-white break-all">{escrow.depositor_address}</code>
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Beneficiary Address</h3>
                <code className="text-sm text-gray-900 dark:text-white break-all">{escrow.beneficiary_address}</code>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Created</h3>
                  <p className="text-sm text-gray-900 dark:text-white">{formatDate(escrow.created_at)}</p>
                </div>
                
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expires</h3>
                  <p className="text-sm text-gray-900 dark:text-white">{formatDate(escrow.expires_at)}</p>
                </div>
              </div>

              {escrow.metadata && Object.keys(escrow.metadata).length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</h3>
                  {(escrow.metadata as any).description ? (
                    <p className="text-sm text-gray-900 dark:text-white">{(escrow.metadata as any).description}</p>
                  ) : (
                    <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded overflow-auto">
                      {JSON.stringify(escrow.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {escrow.dispute_reason && (
                <div>
                  <h3 className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Dispute Reason</h3>
                  <p className="text-sm text-red-800 dark:text-red-300">{escrow.dispute_reason}</p>
                </div>
              )}

              {escrow.deposited_amount && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deposited Amount</h3>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {escrow.deposited_amount} {escrow.chain}
                    </p>
                  </div>
                  
                  {escrow.fee_amount != null && escrow.fee_amount > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Platform Commission</h3>
                      <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                        {escrow.fee_amount} {escrow.chain} ({((escrow.fee_amount / escrow.amount) * 100).toFixed(1)}%)
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Beneficiary receives: {(escrow.amount - escrow.fee_amount).toFixed(6)} {escrow.chain}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {escrow.deposit_tx_hash && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deposit Transaction</h3>
                  <code className="text-xs text-blue-600 dark:text-blue-400 break-all">{escrow.deposit_tx_hash}</code>
                </div>
              )}

              {escrow.settlement_tx_hash && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Settlement Transaction</h3>
                  <code className="text-xs text-green-600 dark:text-green-400 break-all">{escrow.settlement_tx_hash}</code>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions & Events */}
        <div className="lg:col-span-1 space-y-6">
          {/* Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Actions</h2>
            
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded text-sm mb-4">
                {error}
              </div>
            )}

            <div className="space-y-3">
              {role === 'depositor' && (
                <>
                  {(escrow.status === 'funded' || escrow.status === 'disputed') && (
                    <button
                      onClick={() => performAction('release')}
                      disabled={actionLoading !== ''}
                      className="w-full px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionLoading === 'release' ? 'Releasing...' : 'Release Funds'}
                    </button>
                  )}

                  {escrow.status === 'funded' && (
                    <button
                      onClick={() => performAction('refund')}
                      disabled={actionLoading !== ''}
                      className="w-full px-4 py-2 bg-yellow-600 text-white font-medium rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionLoading === 'refund' ? 'Requesting...' : 'Request Refund'}
                    </button>
                  )}

                  {escrow.status === 'funded' && !showDispute && (
                    <button
                      onClick={() => setShowDispute(true)}
                      disabled={actionLoading !== ''}
                      className="w-full px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      File Dispute
                    </button>
                  )}
                </>
              )}

              {role === 'beneficiary' && (
                <>
                  {escrow.status === 'funded' && !showDispute && (
                    <button
                      onClick={() => setShowDispute(true)}
                      disabled={actionLoading !== ''}
                      className="w-full px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      File Dispute
                    </button>
                  )}

                  <div className="text-center text-sm text-gray-500 dark:text-gray-400 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <p>Waiting for depositor to release funds</p>
                  </div>
                </>
              )}

              {/* Dispute Form */}
              {showDispute && (
                <div className="border border-red-200 dark:border-red-800 rounded-lg p-4 bg-red-50 dark:bg-red-900/20">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-400 mb-3">File Dispute</h3>
                  <textarea
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder="Explain the reason for the dispute (minimum 10 characters)..."
                    className="w-full px-3 py-2 border border-red-300 dark:border-red-700 rounded text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    rows={4}
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={submitDispute}
                      disabled={actionLoading === 'dispute' || disputeReason.trim().length < 10}
                      className="flex-1 px-3 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionLoading === 'dispute' ? 'Filing...' : 'Submit Dispute'}
                    </button>
                    <button
                      onClick={() => {
                        setShowDispute(false);
                        setDisputeReason('');
                        setError('');
                      }}
                      className="px-3 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Event Log */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Event Timeline</h2>
            
            {eventsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : events.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No events recorded</p>
            ) : (
              <div className="space-y-4">
                {events.map((event) => (
                  <div key={event.id} className="border-l-2 border-gray-200 dark:border-gray-700 pl-4">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${
                        event.event_type === 'funded' ? 'text-blue-600' :
                        event.event_type === 'settled' ? 'text-green-600' :
                        event.event_type === 'disputed' ? 'text-red-600' :
                        event.event_type === 'released' ? 'text-indigo-600' :
                        event.event_type === 'refunded' ? 'text-yellow-600' :
                        'text-gray-600 dark:text-gray-400'
                      }`}>
                        {event.event_type.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatDate(event.created_at)}
                      </span>
                    </div>
                    {event.actor && event.actor !== 'system' && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        by {shortenAddress(event.actor)}
                      </p>
                    )}
                    {event.details && Object.keys(event.details).length > 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {event.event_type === 'disputed' && (event.details as any).reason && (
                          <p>Reason: {(event.details as any).reason}</p>
                        )}
                        {(event.details as any).amount && (
                          <p>Amount: {(event.details as any).amount} {escrow.chain}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}