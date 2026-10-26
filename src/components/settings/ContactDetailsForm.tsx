'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileFields } from '@profullstack/profile/react';
import type { ProfileField } from '@profullstack/profile';
import { authFetch } from '@/lib/auth/client';

type Values = Partial<Record<ProfileField, string | null>>;
const FIELDS: ProfileField[] = [
  'email',
  'first_name',
  'last_name',
  'company_domain',
  'job_title',
  'linkedin_url',
];

/** The shared @profullstack/profile fields, via /api/v1/me/profile. Private. */
export function ContactDetailsForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const fill = (p: Record<string, string | null> | undefined) =>
    setValues(Object.fromEntries(FIELDS.map((k) => [k, p?.[k] ?? ''])));

  useEffect(() => {
    void (async () => {
      const result = await authFetch('/api/v1/me/profile', {}, router);
      if (result?.response.ok) fill(result.data.profile);
      setLoading(false);
    })();
  }, [router]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setErrors({});
    const result = await authFetch(
      '/api/v1/me/profile',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      },
      router
    );
    setBusy(false);
    if (!result) return;
    if (!result.response.ok) {
      setErrors(result.data.errors ?? {});
      setMessage({ ok: false, text: result.data.error || 'Could not save. Try again.' });
      return;
    }
    fill(result.data.profile);
    setMessage({ ok: true, text: 'Saved.' });
  };

  return (
    <form onSubmit={save} id="contact-details" className="p-6 border-b border-gray-200 dark:border-gray-700 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Contact details</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Your name, work details and LinkedIn. Private to your account.
        </p>
      </div>
      <ProfileFields
        idPrefix="contact-"
        values={values}
        onChange={setValues}
        errors={errors}
        disabled={loading || busy}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading || busy}
          className="bg-purple-600 text-white py-2 px-4 rounded-lg font-semibold hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Saving...' : 'Save details'}
        </button>
        {message && (
          <span className={message.ok ? 'text-sm text-green-600' : 'text-sm text-red-600'}>{message.text}</span>
        )}
      </div>
    </form>
  );
}
