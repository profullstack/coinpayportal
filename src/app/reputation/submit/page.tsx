'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

export default function SubmitReceiptPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    receipt_id: '',
    task_id: '',
    agent_did: '',
    buyer_did: '',
    platform_did: '',
    escrow_tx: '',
    amount: '',
    currency: 'USD',
    category: '',
    outcome: 'accepted' as 'accepted' | 'rejected' | 'disputed',
    escrow_sig: '',
    agent_sig: '',
    buyer_sig: '',
  });

  function generateIds() {
    setForm(f => ({
      ...f,
      receipt_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
    }));
  }

  function updateField(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    const receipt: Record<string, unknown> = {
      receipt_id: form.receipt_id,
      task_id: form.task_id,
      agent_did: form.agent_did,
      buyer_did: form.buyer_did,
      outcome: form.outcome,
      signatures: {
        escrow_sig: form.escrow_sig || 'manual-submission',
      },
    };

    if (form.platform_did) receipt.platform_did = form.platform_did;
    if (form.escrow_tx) receipt.escrow_tx = form.escrow_tx;
    if (form.amount) receipt.amount = parseFloat(form.amount);
    if (form.currency) receipt.currency = form.currency;
    if (form.category) receipt.category = form.category;
    if (form.agent_sig) (receipt.signatures as Record<string, string>).agent_sig = form.agent_sig;
    if (form.buyer_sig) (receipt.signatures as Record<string, string>).buyer_sig = form.buyer_sig;

    try {
      const res = await fetch('/api/reputation/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(receipt),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to submit receipt');
      } else {
        setSuccess('Receipt submitted successfully');
      }
    } catch {
      setError('Failed to submit receipt');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/reputation" className="text-blue-600 hover:underline">← Reputation</Link>
        <h1 className="text-3xl font-bold">Submit Task Receipt</h1>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-4 py-3 rounded-lg mb-6">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Receipt ID</label>
            <input type="text" value={form.receipt_id} onChange={e => updateField('receipt_id', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" required />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Task ID</label>
            <input type="text" value={form.task_id} onChange={e => updateField('task_id', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" required />
          </div>
          <button type="button" onClick={generateIds}
            className="self-end px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300">
            Generate
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Agent DID</label>
          <input type="text" value={form.agent_did} onChange={e => updateField('agent_did', e.target.value)}
            placeholder="did:web:agent.example.com"
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" required />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Buyer DID</label>
          <input type="text" value={form.buyer_did} onChange={e => updateField('buyer_did', e.target.value)}
            placeholder="did:web:buyer.example.com"
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" required />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Amount</label>
            <input type="number" step="0.01" value={form.amount} onChange={e => updateField('amount', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Currency</label>
            <input type="text" value={form.currency} onChange={e => updateField('currency', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <input type="text" value={form.category} onChange={e => updateField('category', e.target.value)}
              placeholder="coding, design, etc."
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Outcome</label>
          <select value={form.outcome} onChange={e => updateField('outcome', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700">
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="disputed">Disputed</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Platform DID (optional)</label>
            <input type="text" value={form.platform_did} onChange={e => updateField('platform_did', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Escrow TX (optional)</label>
            <input type="text" value={form.escrow_tx} onChange={e => updateField('escrow_tx', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Escrow Signature</label>
          <input type="text" value={form.escrow_sig} onChange={e => updateField('escrow_sig', e.target.value)}
            placeholder="Required (or leave empty for 'manual-submission')"
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
        </div>

        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition font-semibold">
          {loading ? 'Submitting...' : 'Submit Receipt'}
        </button>
      </form>
    </div>
  );
}
