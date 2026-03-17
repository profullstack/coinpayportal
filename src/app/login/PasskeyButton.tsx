'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function PasskeyButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasskeyLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');

      const optRes = await fetch('/api/auth/webauthn/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const optData = await optRes.json();
      if (!optRes.ok || !optData.success) {
        setError(optData.error || 'Failed to start passkey login');
        setLoading(false);
        return;
      }

      const credential = await startAuthentication({ optionsJSON: optData.options });

      const verifyRes = await fetch('/api/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential,
          challengeKey: optData._challengeKey,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        setError(verifyData.error || 'Passkey authentication failed');
        setLoading(false);
        return;
      }

      if (verifyData.token) {
        localStorage.setItem('auth_token', verifyData.token);
      }

      router.push(redirectTo || '/dashboard');
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey sign-in was cancelled.');
      } else {
        setError(err.message || 'Passkey authentication failed');
      }
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mt-6 relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white text-gray-500">or</span>
        </div>
      </div>

      <div className="mt-6">
        {error && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={handlePasskeyLogin}
          className="w-full inline-flex items-center justify-center gap-2 bg-gray-900 text-white py-3 px-4 rounded-lg font-semibold hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              Authenticating...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Sign in with Passkey
            </>
          )}
        </button>
      </div>
    </>
  );
}
