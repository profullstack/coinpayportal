'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Business {
  id: string;
  name: string;
}

interface Form {
  reminders_enabled: boolean;
  reminder_days: string;
  late_fee_type: 'none' | 'percent' | 'fixed';
  late_fee_value: string;
  late_fee_after_days: string;
  brand_color: string;
  logo_url: string;
  invoice_footer: string;
}

const input = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm';
const PRESETS: Array<{ label: string; days: number[] }> = [
  { label: 'On the due date only', days: [0] },
  { label: '3 days before, on the day, 7 days late', days: [-3, 0, 7] },
  { label: 'Before, on, then weekly for a month', days: [-3, 0, 7, 14, 21, 28] },
];

/** "-3, 0, 7" <-> [-3, 0, 7] */
const parseDays = (text: string) =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);

export default function InvoiceSettingsPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/businesses', {}, router);
      if (result?.data.success && result.data.businesses.length > 0) {
        setBusinesses(result.data.businesses);
        setBusinessId(result.data.businesses[0].id);
      }
    })();
  }, [router]);

  const load = useCallback(async () => {
    if (!businessId) return;
    const result = await authFetch(`/api/invoice-settings?business_id=${businessId}`, {}, router);
    const s = result?.data.settings;
    if (!s) return;
    setForm({
      reminders_enabled: s.reminders_enabled,
      reminder_days: (s.reminder_days ?? []).join(', '),
      late_fee_type: s.late_fee_type,
      late_fee_value: s.late_fee_value == null ? '' : String(s.late_fee_value),
      late_fee_after_days: String(s.late_fee_after_days ?? 0),
      brand_color: s.brand_color ?? '',
      logo_url: s.logo_url ?? '',
      invoice_footer: s.invoice_footer ?? '',
    });
  }, [businessId, router]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const days = parseDays(form.reminder_days);
    if (days.some((d) => !Number.isInteger(d))) {
      setMessage({ ok: false, text: 'Reminder days must be whole numbers, like -3, 0, 7' });
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await authFetch(
      '/api/invoice-settings',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          reminders_enabled: form.reminders_enabled,
          reminder_days: days,
          late_fee_type: form.late_fee_type,
          late_fee_value: form.late_fee_type === 'none' ? null : Number(form.late_fee_value),
          late_fee_after_days: Number(form.late_fee_after_days || 0),
          brand_color: form.brand_color || null,
          logo_url: form.logo_url.trim() || null,
          invoice_footer: form.invoice_footer.trim() || null,
        }),
      },
      router
    );
    setSaving(false);
    if (result?.data.success) {
      setMessage({ ok: true, text: 'Saved' });
      await load();
    } else {
      setMessage({ ok: false, text: result?.data.error || 'Failed to save' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Link href="/invoices" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
            ← Back to Invoices
          </Link>
          <h1 className="text-3xl font-bold text-white">Reminders &amp; Branding</h1>
          <p className="mt-2 text-gray-400">
            Chase late payments automatically and put your own look on what clients see.
          </p>
        </div>

        {businesses.length > 1 && (
          <select
            aria-label="Business"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}

        {!form ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400" />
          </div>
        ) : (
          <form onSubmit={save} className="space-y-6">
            <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Payment reminders</h2>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.reminders_enabled}
                  onChange={(e) => setForm({ ...form, reminders_enabled: e.target.checked })}
                />
                Email clients about unpaid invoices
              </label>
              <label className="block text-sm text-gray-300">
                Send on these days relative to the due date
                <input
                  aria-label="Reminder days"
                  value={form.reminder_days}
                  onChange={(e) => setForm({ ...form, reminder_days: e.target.value })}
                  placeholder="-3, 0, 7"
                  className={`${input} mt-1`}
                />
                <span className="text-xs text-gray-500">
                  Negative is before it is due, 0 is the due date, 7 is a week late. Up to 10.
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setForm({ ...form, reminder_days: p.days.join(', ') })}
                    className="px-3 py-1 text-xs rounded-full border border-gray-600 text-gray-300 hover:border-purple-500"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Late fee</h2>
              <p className="text-sm text-gray-400">
                Charged once per invoice as its own invoice for the fee, emailed to the client with a pay link. The
                original invoice and its payment details stay exactly as they were.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-sm text-gray-300">
                  Type
                  <select
                    aria-label="Late fee type"
                    value={form.late_fee_type}
                    onChange={(e) => setForm({ ...form, late_fee_type: e.target.value as Form['late_fee_type'] })}
                    className={`${input} mt-1`}
                  >
                    <option value="none">No late fee</option>
                    <option value="percent">Percent of invoice</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </label>
                <label className="text-sm text-gray-300">
                  {form.late_fee_type === 'percent' ? 'Percent' : 'Amount'}
                  <input
                    aria-label="Late fee value"
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={form.late_fee_type === 'none'}
                    value={form.late_fee_value}
                    onChange={(e) => setForm({ ...form, late_fee_value: e.target.value })}
                    className={`${input} mt-1 disabled:opacity-50`}
                  />
                </label>
                <label className="text-sm text-gray-300">
                  Days after due
                  <input
                    aria-label="Late fee grace days"
                    type="number"
                    min="0"
                    max="365"
                    disabled={form.late_fee_type === 'none'}
                    value={form.late_fee_after_days}
                    onChange={(e) => setForm({ ...form, late_fee_after_days: e.target.value })}
                    className={`${input} mt-1 disabled:opacity-50`}
                  />
                </label>
              </div>
            </section>

            <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Branding</h2>
              <p className="text-sm text-gray-400">Shown on invoice emails, the pay page and the client portal.</p>
              <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 items-end">
                <label className="text-sm text-gray-300">
                  Accent colour
                  <input
                    aria-label="Accent colour"
                    type="color"
                    value={form.brand_color || '#9333ea'}
                    onChange={(e) => setForm({ ...form, brand_color: e.target.value })}
                    className="mt-1 h-10 w-20 rounded bg-gray-700 border border-gray-600"
                  />
                </label>
                <label className="text-sm text-gray-300">
                  Logo URL (https)
                  <input
                    aria-label="Logo URL"
                    type="url"
                    value={form.logo_url}
                    onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                    placeholder="https://example.com/logo.png"
                    className={`${input} mt-1`}
                  />
                </label>
              </div>
              {form.brand_color && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, brand_color: '' })}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Use the default colour
                </button>
              )}
              <label className="block text-sm text-gray-300">
                Footer text
                <textarea
                  aria-label="Footer text"
                  value={form.invoice_footer}
                  onChange={(e) => setForm({ ...form, invoice_footer: e.target.value })}
                  rows={3}
                  maxLength={1000}
                  placeholder="Thanks for your business! Questions: billing@example.com"
                  className={`${input} mt-1`}
                />
              </label>
            </section>

            <div className="flex items-center justify-end gap-4">
              {message && (
                <span className={message.ok ? 'text-green-400 text-sm' : 'text-red-400 text-sm'}>{message.text}</span>
              )}
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
