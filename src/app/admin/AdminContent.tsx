'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Kind = 'outrank' | 'crawlproof';

type Integration = {
  id: string;
  name: string;
  kind: Kind;
  access_token: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
};

const KIND_META: Record<Kind, { label: string; defaultName: string; webhookPath: string; setupHref: string }> = {
  outrank: {
    label: 'Outrank',
    defaultName: 'Outrank',
    webhookPath: '/api/webhooks/outrank',
    setupHref: 'https://outrank.so',
  },
  crawlproof: {
    label: 'Crawlproof',
    defaultName: 'Crawlproof',
    webhookPath: '/api/webhooks/crawlproof',
    setupHref: 'https://crawlproof.com/docs/autoblog-webhook',
  },
};

function webhookUrlFor(kind: Kind): string {
  if (typeof window === 'undefined') return KIND_META[kind].webhookPath;
  return `${window.location.origin}${KIND_META[kind].webhookPath}`;
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export default function AdminContent() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<'unknown' | 'unauthenticated' | 'forbidden' | 'ok'>('unknown');
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<Kind>('crawlproof');
  const [newName, setNewName] = useState(KIND_META.crawlproof.defaultName);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/integrations', { headers: authHeaders() });
      if (res.status === 401) {
        setAuthState('unauthenticated');
        return;
      }
      if (res.status === 403) {
        setAuthState('forbidden');
        return;
      }
      if (!res.ok) {
        setError('Failed to load integrations');
        return;
      }
      const data = await res.json();
      setIntegrations(data.integrations || []);
      setAuthState('ok');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchIntegrations();
  }, [fetchIntegrations]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: newName, kind: newKind }),
      });
      if (!res.ok) {
        setError('Failed to create integration');
        return;
      }
      const data = await res.json();
      setIntegrations((prev) => [data.integration, ...prev]);
      setRevealed((prev) => ({ ...prev, [data.integration.id]: true }));
      setNewName(KIND_META[newKind].defaultName);
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (it: Integration) => {
    if (!confirm(`Revoke this ${KIND_META[it.kind].label} integration? The source will stop being able to publish.`)) return;
    try {
      const res = await fetch(`/api/admin/integrations/${it.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        setError('Failed to delete');
        return;
      }
      setIntegrations((prev) => prev.filter((i) => i.id !== it.id));
    } catch {
      setError('Network error');
    }
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  if (authState === 'unauthenticated') {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-gray-300 mb-4">You need to log in.</p>
        <Link href="/login" className="text-purple-400 hover:underline">Log in →</Link>
      </div>
    );
  }

  if (authState === 'forbidden') {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-red-400 mb-2">403 — Forbidden</p>
        <p className="text-gray-400 mb-4">This area is restricted to administrators.</p>
        <Link href="/dashboard" className="text-purple-400 hover:underline">Back to dashboard →</Link>
      </div>
    );
  }

  if (loading || authState === 'unknown') {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-gray-400">Loading…</div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-3xl font-bold text-white mb-2">Admin</h1>
      <p className="text-gray-400 mb-8">Blog publishing webhooks (Crawlproof, Outrank)</p>

      {error && (
        <div className="mb-4 rounded border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="mb-8 rounded-lg border border-slate-700 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Webhook endpoints</h2>
        <div className="space-y-3">
          {(Object.keys(KIND_META) as Kind[]).map((k) => {
            const url = webhookUrlFor(k);
            const meta = KIND_META[k];
            return (
              <div key={k}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-white">{meta.label}</span>
                  <a
                    href={meta.setupHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 hover:text-purple-300"
                  >
                    docs ↗
                  </a>
                </div>
                <div className="flex gap-2">
                  <code className="flex-1 break-all rounded bg-slate-950 px-3 py-2 text-sm text-purple-300 font-mono">
                    {url}
                  </code>
                  <button
                    onClick={() => copy(`url-${k}`, url)}
                    className="rounded bg-purple-600/20 px-3 py-2 text-sm text-purple-300 hover:bg-purple-600/30"
                  >
                    {copied === `url-${k}` ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Access tokens</h2>
          <button
            onClick={fetchIntegrations}
            disabled={loading}
            className="text-sm text-gray-400 hover:text-purple-300 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
          <select
            value={newKind}
            onChange={(e) => {
              const k = e.target.value as Kind;
              setNewKind(k);
              setNewName(KIND_META[k].defaultName);
            }}
            className="rounded bg-slate-950 px-3 py-2 text-sm text-white border border-slate-700 focus:border-purple-500 focus:outline-none"
          >
            {(Object.keys(KIND_META) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Integration name"
            className="rounded bg-slate-950 px-3 py-2 text-sm text-white border border-slate-700 focus:border-purple-500 focus:outline-none"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Generate token'}
          </button>
        </div>

        {integrations.length === 0 ? (
          <p className="text-sm text-gray-400">No integrations yet — generate a token above.</p>
        ) : (
          <ul className="space-y-3">
            {integrations.map((it) => {
              const isRevealed = !!revealed[it.id];
              const masked = `${it.access_token.slice(0, 8)}…${it.access_token.slice(-4)}`;
              const kindLabel = KIND_META[it.kind]?.label ?? it.kind;
              return (
                <li key={it.id} className="rounded border border-slate-700/60 bg-slate-950/60 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-3">
                        <span className="font-medium text-white">{it.name}</span>
                        <span className="rounded bg-purple-500/10 px-2 py-0.5 text-xs uppercase tracking-wide text-purple-300">
                          {kindLabel}
                        </span>
                        <span className="text-xs text-gray-400">
                          {it.request_count} requests
                          {it.last_used_at && ` · last ${new Date(it.last_used_at).toLocaleString()}`}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="flex-1 break-all rounded bg-black/40 px-2 py-1 text-xs text-purple-300 font-mono">
                          {isRevealed ? it.access_token : masked}
                        </code>
                        <button
                          onClick={() => setRevealed((prev) => ({ ...prev, [it.id]: !prev[it.id] }))}
                          className="text-xs text-gray-400 hover:text-purple-300"
                        >
                          {isRevealed ? 'Hide' : 'Reveal'}
                        </button>
                        <button
                          onClick={() => copy(it.id, it.access_token)}
                          className="text-xs text-gray-400 hover:text-purple-300"
                        >
                          {copied === it.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-gray-400">
                        Use as <code className="text-purple-300">Authorization: Bearer &lt;token&gt;</code> in {kindLabel}.
                        Created {new Date(it.created_at).toLocaleDateString()}.
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(it)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
