'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

export interface ManualMethodState {
  method_id: string;
  display_name: string;
  enabled: boolean;
  handle: string;
  instructions: string;
}

interface ManualMethodCardProps {
  businessId: string;
  method: ManualMethodState;
  /** e.g. "$cashtag", "@username", "email or phone" */
  handlePlaceholder: string;
  onChange: () => void;
}

/**
 * One 3rd-party manual rail (Venmo / Cash App / Zelle). CoinPay never touches
 * the money here — the merchant saves their own handle, the customer pays them
 * directly, and the merchant marks the invoice paid. Off until a handle is saved.
 */
export function ManualMethodCard({ businessId, method, handlePlaceholder, onChange }: ManualMethodCardProps) {
  const router = useRouter();
  const [handle, setHandle] = useState(method.handle);
  const [instructions, setInstructions] = useState(method.instructions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (enabled: boolean) => {
    setError('');
    setSaving(true);
    try {
      const result = await authFetch(`/api/businesses/${businessId}/payment-methods/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method_id: method.method_id, handle, instructions, enabled }),
      }, router);
      if (!result) { setSaving(false); return; }
      const { response, data } = result;
      if (response.ok && data.success) {
        onChange();
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Failed to save');
    }
    setSaving(false);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-base font-semibold text-gray-100">{method.display_name}</h4>
        <span
          className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${
            method.enabled
              ? 'bg-green-900/50 text-green-400 border border-green-700'
              : 'bg-gray-700 text-gray-400 border border-gray-600'
          }`}
        >
          {method.enabled ? 'On' : 'Off'}
        </span>
      </div>

      {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

      <div className="space-y-2">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Your {method.display_name} handle</label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={handlePlaceholder}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Instructions for the customer (optional)</label>
          <input
            type="text"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Include the invoice number in the note"
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => save(true)}
          disabled={saving || !handle.trim()}
          className="px-4 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : method.enabled ? 'Save' : 'Save & turn on'}
        </button>
        {method.enabled && (
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="px-4 py-1.5 bg-gray-700 text-gray-300 text-xs font-medium rounded-lg hover:bg-gray-600 disabled:opacity-50"
          >
            Turn off
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Customers pay you directly via {method.display_name}; you mark the invoice paid once you receive it. No CoinPay fee.
      </p>
    </div>
  );
}
