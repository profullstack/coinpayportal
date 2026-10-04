'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { ManualMethodCard, type ManualMethodState } from './ManualMethodCard';

interface ThirdPartyTabProps {
  businessId: string;
}

const HANDLE_PLACEHOLDERS: Record<string, string> = {
  paypal_manual: 'paypal.me/yourname',
  venmo: '@your-venmo-username',
  cashapp: '$yourcashtag',
  zelle: 'email or phone linked to Zelle',
};

/**
 * The "3rd Party" payment settings tab: the manual P2P rails — PayPal.Me, Venmo,
 * Cash App and Zelle — where CoinPay never touches the money. The merchant shows
 * their own handle, the customer pays them directly, and the merchant marks the
 * invoice paid. Every method is OFF until a handle is saved.
 *
 * The automated PayPal rail is NOT here; it lives in the PayPal mode. PayPal
 * appears in both places as two genuinely different products that share a brand.
 */
export function ThirdPartyTab({ businessId }: ThirdPartyTabProps) {
  const router = useRouter();
  const [manual, setManual] = useState<ManualMethodState[]>([]);
  const [loading, setLoading] = useState(true);

  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const fetchManual = useCallback(async () => {
    try {
      const result = await authFetch(`/api/businesses/${businessId}/payment-methods/manual`, {}, router);
      if (!result) return;
      const { response, data } = result;
      if (response.ok && data.success) setManual(data.methods || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  const importDefaults = useCallback(async () => {
    setImporting(true);
    setImportMsg('');
    try {
      const result = await authFetch(`/api/businesses/${businessId}/payment-methods/manual/import`, {
        method: 'POST',
      }, router);
      if (result?.response.ok && result.data.success) {
        setImportMsg(
          result.data.imported > 0
            ? `Imported ${result.data.imported} method${result.data.imported === 1 ? '' : 's'} from your account defaults.`
            : 'No account defaults to import yet — set them in Settings → Payment Methods.'
        );
        await fetchManual();
      } else {
        setImportMsg(result?.data.error || 'Failed to import.');
      }
    } catch {
      setImportMsg('Failed to import.');
    }
    setImporting(false);
  }, [businessId, router, fetchManual]);

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
      {/* The AUTOMATED PayPal rail is configured in the PayPal mode, not here —
          two places to connect the same account is how a merchant ends up with a
          half-configured one. PayPal.Me below is a different product that
          happens to share the brand: a handle we display, with no API behind it. */}
      <section>
        <h3 className="text-lg font-semibold text-gray-100 mb-1">Automated PayPal</h3>
        <p className="text-xs text-gray-500">
          To have CoinPay create and capture PayPal payments for you — with webhooks, refunds and a
          transactions dashboard — use the{' '}
          <span className="font-medium text-gray-300">🅿️ PayPal</span> mode at the top of this page.
          If you would rather just show customers a PayPal.Me link and mark invoices paid yourself,
          set that up below instead.
        </p>
      </section>

      <section>
        <div className="flex items-start justify-between gap-4 mb-1">
          <h3 className="text-lg font-semibold text-gray-100">Manual P2P methods</h3>
          <button
            onClick={importDefaults}
            disabled={importing}
            className="shrink-0 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium rounded-lg disabled:opacity-50"
            title="Apply the handles saved on your account to this business"
          >
            {importing ? 'Importing…' : '⬇ Import account defaults'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          PayPal.Me, Venmo, Cash App, and Zelle. Customers pay you directly with your handle and you
          mark the invoice paid — no CoinPay fee, no API keys, and no account linking required. Each
          is off until you save a handle.
          Set handles once in <a href="/settings/payment-methods" className="text-purple-400 hover:text-purple-300 underline">Settings → Payment Methods</a> and import them here.
        </p>
        {importMsg && <p className="text-xs text-emerald-400 mb-3">{importMsg}</p>}
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
