'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { PayPalConnectTab } from './PayPalConnectTab';
import { ManualMethodCard, type ManualMethodState } from './ManualMethodCard';

interface ThirdPartyTabProps {
  businessId: string;
}

const HANDLE_PLACEHOLDERS: Record<string, string> = {
  venmo: '@your-venmo-username',
  cashapp: '$yourcashtag',
  zelle: 'email or phone linked to Zelle',
};

/**
 * The consolidated "3rd Party" payment settings tab: PayPal (merchant-connected
 * API credentials) plus the manual P2P rails (Venmo / Cash App / Zelle). Every
 * method is OFF until the merchant sets it up here.
 */
export function ThirdPartyTab({ businessId }: ThirdPartyTabProps) {
  const router = useRouter();
  const [manual, setManual] = useState<ManualMethodState[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchManual = useCallback(async () => {
    try {
      const result = await authFetch(`/api/businesses/${businessId}/payment-methods/manual`, {}, router);
      if (!result) return;
      const { response, data } = result;
      if (response.ok && data.success) setManual(data.methods || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchManual();
      setLoading(false);
    };
    load();
  }, [fetchManual]);

  return (
    <div className="space-y-10">
      <section>
        <h3 className="text-lg font-semibold text-gray-100 mb-1">PayPal</h3>
        <p className="text-xs text-gray-500 mb-4">
          Connect your PayPal account to accept PayPal payments on invoices. Off until connected.
        </p>
        <PayPalConnectTab businessId={businessId} />
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-100 mb-1">Manual P2P methods</h3>
        <p className="text-xs text-gray-500 mb-4">
          Venmo, Cash App, and Zelle. Customers pay you directly with your handle and you mark the
          invoice paid — no CoinPay fee, and no account linking required. Each is off until you save a handle.
        </p>
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mx-auto"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {manual.map((m) => (
              <ManualMethodCard
                key={m.method_id}
                businessId={businessId}
                method={m}
                handlePlaceholder={HANDLE_PLACEHOLDERS[m.method_id] || 'your handle'}
                onChange={fetchManual}
              />
            ))}
            {manual.length === 0 && (
              <p className="text-sm text-gray-500">No manual methods are available.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
