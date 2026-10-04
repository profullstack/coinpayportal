'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type HistoryType = 'generated' | 'emailed' | 'digest' | 'uploaded';

interface HistoryItem {
  type: HistoryType;
  id: string;
  at: string;
  title: string;
  detail: string | null;
  status: string | null;
  downloads: Array<{ label: string; url: string }>;
  recipients?: string[];
  openedCount?: number;
  expiresAt?: string | null;
  revoked?: boolean;
  category?: string;
}

type Role = 'owner' | 'admin' | 'writer' | 'readonly';

const FILTERS: Array<{ key: HistoryType | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'generated', label: 'Generated' },
  { key: 'emailed', label: 'Emailed' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'digest', label: 'Pending / failed sends' },
];

const BADGE: Record<HistoryType, string> = {
  generated: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  emailed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  uploaded: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  digest: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

const TYPE_LABEL: Record<HistoryType, string> = {
  generated: 'Generated',
  emailed: 'Emailed',
  uploaded: 'Uploaded',
  digest: 'Send',
};

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function readError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const d = data as { error?: unknown; message?: unknown };
    if (typeof d.error === 'string') return d.error;
    if (d.error && typeof d.error === 'object' && typeof (d.error as { message?: unknown }).message === 'string') {
      return (d.error as { message: string }).message;
    }
    if (typeof d.message === 'string') return d.message;
  }
  return fallback;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const btn = 'rounded border border-slate-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-50';
const input = 'w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500';

export default function HistoryContent() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [role, setRole] = useState<Role>('readonly');
  const [filter, setFilter] = useState<HistoryType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);

  const canManage = role === 'owner' || role === 'admin';

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/finances/history?limit=300', { headers: authHeaders(), cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(readError(data, `Could not load the history (HTTP ${res.status})`));
      setItems(data.items ?? []);
      if (data.role) setRole(data.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const download = async (url: string, fallback: string) => {
    setError(null);
    try {
      const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(readError(data, `Download failed (HTTP ${res.status})`));
      }
      const blob = await res.blob();
      const match = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = match?.[1] ?? fallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a file to upload');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await fetch('/api/finances/documents', { method: 'POST', headers: authHeaders(), body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(readError(data, `Upload failed (HTTP ${res.status})`));
      setNotice(`Added "${data.document?.title ?? file.name}"`);
      setShowUpload(false);
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeDoc = async (item: HistoryItem) => {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/finances/documents/${item.id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(readError(data, 'Could not delete the document'));
    setNotice('Document deleted');
    await load();
  };

  const revoke = async (item: HistoryItem) => {
    if (!confirm('Stop this emailed link from working? The email itself cannot be unsent.')) return;
    const res = await fetch(`/api/finances/share-links/${item.id}/revoke`, { method: 'POST', headers: authHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(readError(data, 'Could not revoke the link'));
    setNotice('Link revoked');
    await load();
  };

  const shown = filter === 'all' ? items : items.filter((i) => i.type === filter);
  const counts = items.reduce<Record<string, number>>((acc, i) => ((acc[i.type] = (acc[i.type] ?? 0) + 1), acc), {});

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-gray-100">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Report history</h1>
          <p className="mt-1 text-sm text-gray-400">
            Every business report in one place: what CoinPay generated, what was emailed and to whom, and documents added from elsewhere.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/finances" className="rounded border border-slate-600 px-4 py-2 text-sm text-gray-300 hover:bg-slate-800">
            Finances
          </Link>
          <Link href="/finances/reports" className="rounded border border-slate-600 px-4 py-2 text-sm text-gray-300 hover:bg-slate-800">
            Generate a report
          </Link>
          {canManage && (
            <button
              onClick={() => setShowUpload((v) => !v)}
              className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
            >
              Upload document
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
      )}
      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      {showUpload && canManage && (
        <form onSubmit={upload} className="mb-6 rounded-lg border border-slate-700 bg-slate-900/60 p-4 grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm">
            <span className="block mb-1 text-gray-300">File (PDF, CSV, image, XLSX, DOCX; up to 25 MB)</span>
            <input name="file" type="file" required accept=".pdf,.csv,.txt,.md,.png,.jpg,.jpeg,.xlsx,.docx" className="text-sm text-gray-300" />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-gray-300">Title</span>
            <input name="title" required maxLength={200} placeholder="Monthly spend report, October 2026" className={input} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-gray-300">Period (optional)</span>
            <input name="period" maxLength={60} placeholder="2026-10" className={input} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-gray-300">Type</span>
            <select name="category" defaultValue="report" className={input}>
              <option value="report">Report</option>
              <option value="statement">Statement</option>
              <option value="tax">Tax</option>
              <option value="invoice">Invoice / receipt</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-gray-300">Notes (optional)</span>
            <input name="notes" maxLength={2000} className={input} />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowUpload(false)} className={btn}>Cancel</button>
            <button type="submit" disabled={uploading} className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50">
              {uploading ? 'Uploading…' : 'Add to history'}
            </button>
          </div>
        </form>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === f.key ? 'border-purple-400 bg-purple-500/20 text-purple-200' : 'border-slate-600 text-gray-300 hover:bg-slate-800'
            }`}
          >
            {f.label}
            {f.key !== 'all' && counts[f.key] ? ` (${counts[f.key]})` : f.key === 'all' && items.length ? ` (${items.length})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-gray-400">
          Nothing here yet. Generate a report, email the books to your accountant, or upload a document.
        </div>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-700 bg-slate-900/40">
          {shown.map((item) => (
            <li key={`${item.type}-${item.id}`} className="p-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-[11px] ${BADGE[item.type]}`}>{TYPE_LABEL[item.type]}</span>
                  <span className="font-medium text-white truncate">{item.title}</span>
                  {item.status && item.status !== 'active' && item.status !== 'ready' && (
                    <span className="text-[11px] text-gray-400">· {item.status}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {fmtDate(item.at)}
                  {item.detail ? ` · ${item.detail}` : ''}
                </div>
                {item.recipients && item.recipients.length > 0 && (
                  <div className="mt-1 text-xs text-gray-400">
                    To {item.recipients.join(', ')}
                    {typeof item.openedCount === 'number' && ` · opened ${item.openedCount} time${item.openedCount === 1 ? '' : 's'}`}
                    {item.expiresAt && !item.revoked && ` · link expires ${new Date(item.expiresAt).toLocaleDateString()}`}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.downloads.map((d) => (
                  <button key={d.url} className={btn} onClick={() => download(d.url, `${item.title}.${d.label.split(' ')[0].toLowerCase()}`)}>
                    {d.label}
                  </button>
                ))}
                {canManage && item.type === 'emailed' && item.status === 'active' && (
                  <button className={`${btn} text-red-300`} onClick={() => revoke(item)}>Revoke link</button>
                )}
                {canManage && item.type === 'uploaded' && (
                  <button className={`${btn} text-red-300`} onClick={() => removeDoc(item)}>Delete</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
