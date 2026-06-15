'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getAuthToken, authFetch } from '@/lib/auth/client';

function AcceptInvite() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
  const [message, setMessage] = useState('Accepting your invitation…');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('This invitation link is missing its token.');
      return;
    }

    // Not signed in: bounce through login/signup, then return here to finish.
    if (!getAuthToken()) {
      const back = `/invite/accept?token=${encodeURIComponent(token)}`;
      router.push(`/login?redirect=${encodeURIComponent(back)}`);
      return;
    }

    (async () => {
      const result = await authFetch(
        '/api/invitations/accept',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        },
        router,
      );
      if (!result) return; // authFetch handled a 401 redirect
      const { response, data } = result;
      if (!response.ok || !data.success) {
        setStatus('error');
        setMessage(data.error || 'We could not accept this invitation.');
        return;
      }
      setStatus('success');
      setMessage('Invitation accepted! Redirecting…');
      setTimeout(() => {
        router.push(data.scope === 'business' ? `/businesses/${data.scopeId}` : '/dashboard');
      }, 1200);
    })();
  }, [token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Team invitation</h1>
        <p
          className={
            status === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-600 dark:text-gray-300'
          }
        >
          {message}
        </p>
        {status === 'error' && (
          <Link
            href="/dashboard"
            className="inline-block mt-6 bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-lg"
          >
            Go to dashboard
          </Link>
        )}
      </div>
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>}>
      <AcceptInvite />
    </Suspense>
  );
}
