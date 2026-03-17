'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      // Store token
      if (data.token) {
        localStorage.setItem('auth_token', data.token);
      }

      // Redirect based on admin status or redirect param
      if (redirectTo) {
        router.push(redirectTo);
      } else if (data.merchant?.is_admin) {
        router.push('/admin');
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Email Address
          </label>
          <input
            id="email"
            type="email"
            required
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder:text-gray-400 text-gray-900"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-sm text-purple-600 hover:text-purple-500"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            value={formData.password}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder:text-gray-400 text-gray-900"
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Logging in...' : 'Log in'}
        </button>
      </form>

      {/* Divider */}
      <div className="mt-6 relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white text-gray-500">or</span>
        </div>
      </div>

      {/* Passkey Login */}
      <div className="mt-6">
        <button
          type="button"
          disabled={passkeyLoading}
          onClick={async () => {
            setError('');
            setPasskeyLoading(true);
            try {
              // 1. Get auth options (optionally with email)
              const optRes = await fetch('/api/auth/webauthn/login-options', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: formData.email || undefined }),
              });
              const optData = await optRes.json();
              if (!optRes.ok || !optData.success) {
                setError(optData.error || 'Failed to start passkey login');
                setPasskeyLoading(false);
                return;
              }

              // 2. Browser WebAuthn prompt
              const credential = await startAuthentication({ optionsJSON: optData.options });

              // 3. Verify with server
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
                setPasskeyLoading(false);
                return;
              }

              // 4. Store token and redirect
              if (verifyData.token) {
                localStorage.setItem('auth_token', verifyData.token);
              }

              if (redirectTo) {
                router.push(redirectTo);
              } else if (verifyData.merchant?.is_admin) {
                router.push('/admin');
              } else {
                router.push('/dashboard');
              }
            } catch (err: any) {
              if (err.name === 'NotAllowedError') {
                setError('Passkey sign-in was cancelled.');
              } else {
                setError(err.message || 'Passkey authentication failed');
              }
              setPasskeyLoading(false);
            }
          }}
          className="w-full inline-flex items-center justify-center gap-2 bg-gray-900 text-white py-3 px-4 rounded-lg font-semibold hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {passkeyLoading ? (
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

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-600">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="text-purple-600 hover:text-purple-500 font-medium"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
