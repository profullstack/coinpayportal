'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';

const SCOPE_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  openid: { label: 'Identity', description: 'Verify your identity', icon: '🔑' },
  profile: { label: 'Profile', description: 'Access your name and profile picture', icon: '👤' },
  email: { label: 'Email', description: 'Access your email address', icon: '📧' },
  did: { label: 'DID', description: 'Access your decentralized identifier', icon: '🆔' },
  'wallet:read': { label: 'Wallet', description: 'View your wallet addresses', icon: '💰' },
};

function ConsentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [appName, setAppName] = useState<string>('');
  const [appDescription, setAppDescription] = useState<string>('');
  const [error, setError] = useState<string>('');

  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const scope = searchParams.get('scope') || 'openid';
  const state = searchParams.get('state') || undefined;
  const codeChallenge = searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod = searchParams.get('code_challenge_method') || undefined;
  const nonce = searchParams.get('nonce') || undefined;

  const scopes = scope.split(' ').filter(Boolean);

  useEffect(() => {
    // Fetch client info
    async function fetchClient() {
      try {
        const res = await fetch(`/api/oauth/clients/lookup?client_id=${encodeURIComponent(clientId)}`);
        if (res.ok) {
          const data = await res.json();
          setAppName(data.name || clientId);
          setAppDescription(data.description || '');
        } else {
          setAppName(clientId);
        }
      } catch {
        setAppName(clientId);
      }
    }
    if (clientId) fetchClient();
  }, [clientId]);

  async function handleConsent(action: 'approve' | 'deny') {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          nonce,
          action,
        }),
      });

      const data = await res.json();

      if (data.redirect) {
        window.location.href = data.redirect;
      } else if (data.error) {
        setError(data.error_description || data.error);
      }
    } catch (err) {
      setError('Failed to process consent');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Authorize Application
          </h1>
          <p className="text-gray-400">
            {appName || 'An application'} wants to access your CoinPay account
          </p>
        </div>

        <div className="bg-slate-800 rounded-lg shadow-lg p-8">
          {appDescription && (
            <p className="text-gray-300 text-sm mb-6">{appDescription}</p>
          )}

          <div className="mb-6">
            <h2 className="text-white font-semibold mb-3">This app will be able to:</h2>
            <ul className="space-y-3">
              {scopes.map((s) => {
                const info = SCOPE_LABELS[s];
                if (!info) return null;
                return (
                  <li key={s} className="flex items-start gap-3 text-gray-300">
                    <span className="text-xl">{info.icon}</span>
                    <div>
                      <div className="font-medium text-white">{info.label}</div>
                      <div className="text-sm text-gray-400">{info.description}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => handleConsent('deny')}
              disabled={loading}
              className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              Deny
            </button>
            <button
              onClick={() => handleConsent('approve')}
              disabled={loading}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Authorizing...' : 'Authorize'}
            </button>
          </div>

          <p className="mt-4 text-center text-xs text-gray-500">
            You can revoke access at any time from your account settings.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <ConsentContent />
    </Suspense>
  );
}
