'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BUSINESS_CATEGORIES,
  CATEGORY_GROUPS,
  getCategory,
  type RiskLevel,
} from '@/lib/business/taxonomy';

type AdminBusiness = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  risk_level: RiskLevel | null;
  risk_flags: { code: string; label: string; severity: string; matched: string[] }[] | null;
  review_status: string | null;
  active: boolean;
  created_at: string;
  merchant_id: string | null;
  owner_email: string | null;
  webhook_url: string | null;
};

type LinkedBusiness = {
  id: string;
  name: string;
  category: string | null;
  risk_level: RiskLevel | null;
  review_status: string | null;
  link: { kinds: string[]; evidence: string[] } | null;
};

const RISK_STYLES: Record<string, string> = {
  low: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800',
  medium: 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800',
  high: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800',
  prohibited: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
};

const PAGE_SIZE = 50;

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export default function BusinessesContent() {
  const [businesses, setBusinesses] = useState<AdminBusiness[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'unknown' | 'unauthenticated' | 'forbidden' | 'ok'>('unknown');

  // Filters
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [category, setCategory] = useState('');
  const [risk, setRisk] = useState('');
  const [review, setReview] = useState('');

  // Row expansion + tag editing
  const [expanded, setExpanded] = useState<string | null>(null);
  const [linked, setLinked] = useState<LinkedBusiness[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      for (const tag of tagFilter.split(',').map((t) => t.trim()).filter(Boolean)) {
        params.append('tag', tag);
      }
      if (category) params.set('category', category);
      if (risk) params.set('risk', risk);
      if (review) params.set('review', review);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));

      const res = await fetch(`/api/admin/businesses?${params}`, { headers: authHeaders() });
      if (res.status === 401) return setAuthState('unauthenticated');
      if (res.status === 403) return setAuthState('forbidden');
      if (!res.ok) return setError('Failed to load businesses');

      const data = await res.json();
      setBusinesses(data.businesses || []);
      setTotal(data.total || 0);
      setAuthState('ok');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [search, tagFilter, category, risk, review, offset]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const openRow = async (business: AdminBusiness) => {
    if (expanded === business.id) {
      setExpanded(null);
      return;
    }
    setExpanded(business.id);
    setTagDraft((business.tags ?? []).join(', '));
    setLinked([]);
    try {
      const res = await fetch(`/api/admin/businesses/${business.id}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setLinked(data.linkedBusinesses || []);
      }
    } catch {
      // Linkage is supplementary; the row is still usable without it.
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/businesses/${id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Update failed');
        return;
      }
      await load();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  };

  if (authState === 'unauthenticated') {
    return <Shell><p className="text-gray-600 dark:text-gray-300">Please <Link href="/login" className="text-purple-600 hover:underline">sign in</Link>.</p></Shell>;
  }
  if (authState === 'forbidden') {
    return <Shell><p className="text-gray-600 dark:text-gray-300">Admin access required.</p></Shell>;
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Businesses</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {total} total across every merchant
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-purple-600 hover:text-purple-500">
          ← Admin
        </Link>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
        <input
          type="search"
          value={search}
          onChange={(e) => { setOffset(0); setSearch(e.target.value); }}
          placeholder="Search name or description"
          className="md:col-span-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white dark:bg-gray-700"
        />
        <input
          type="search"
          value={tagFilter}
          onChange={(e) => { setOffset(0); setTagFilter(e.target.value); }}
          placeholder="Tags, comma separated"
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white dark:bg-gray-700"
        />
        <select
          value={category}
          onChange={(e) => { setOffset(0); setCategory(e.target.value); }}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white dark:bg-gray-700"
        >
          <option value="">All categories</option>
          {CATEGORY_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {BUSINESS_CATEGORIES.filter((c) => c.group === group).map((c) => (
                <option key={c.slug} value={c.slug}>{c.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="flex gap-2">
          <select
            value={risk}
            onChange={(e) => { setOffset(0); setRisk(e.target.value); }}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white dark:bg-gray-700"
          >
            <option value="">Any risk</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="prohibited">Prohibited</option>
          </select>
          <select
            value={review}
            onChange={(e) => { setOffset(0); setReview(e.target.value); }}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white dark:bg-gray-700"
          >
            <option value="">Any review</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="not_required">Not required</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      ) : businesses.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No businesses match those filters.</p>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-left text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Tags</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {businesses.map((b) => (
                <Fragment key={b.id}>
                  <tr
                    onClick={() => openRow(b)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-white">{b.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(b.created_at).toLocaleDateString()}
                        {!b.active && ' · inactive'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{b.owner_email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {getCategory(b.category)?.label ?? <span className="text-gray-400">Uncategorized</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(b.tags ?? []).slice(0, 4).map((tag) => (
                          <span key={tag} className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {b.risk_level && (
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs ${RISK_STYLES[b.risk_level] ?? ''}`}>
                          {b.risk_level}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {b.review_status === 'pending' ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-400 text-xs">
                          pending
                        </span>
                      ) : (
                        b.review_status
                      )}
                    </td>
                  </tr>

                  {expanded === b.id && (
                    <tr className="bg-gray-50 dark:bg-gray-900">
                      <td colSpan={6} className="px-4 py-4 space-y-4">
                        {b.description && (
                          <p className="text-gray-700 dark:text-gray-300">{b.description}</p>
                        )}

                        {(b.risk_flags ?? []).length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Why it scored</div>
                            <ul className="list-disc list-inside text-gray-700 dark:text-gray-300">
                              {(b.risk_flags ?? []).map((f) => (
                                <li key={f.code}>
                                  {f.label} ({f.severity})
                                  {f.matched?.length > 0 && ` — ${f.matched.join(', ')}`}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {linked.length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                              Linked accounts
                            </div>
                            <ul className="space-y-1">
                              {linked.map((l) => (
                                <li key={l.id} className="text-gray-700 dark:text-gray-300">
                                  <Link href={`/businesses/${l.id}`} className="text-purple-600 hover:underline">
                                    {l.name}
                                  </Link>
                                  {l.link && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {' '}— {l.link.kinds.join(', ')}: {l.link.evidence.join(', ')}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                            Tags (comma separated)
                          </label>
                          <div className="flex gap-2">
                            <input
                              value={tagDraft}
                              onChange={(e) => setTagDraft(e.target.value)}
                              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white dark:bg-gray-700"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                patch(b.id, {
                                  tags: tagDraft.split(',').map((t) => t.trim()).filter(Boolean),
                                })
                              }
                              className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-500 disabled:opacity-50"
                            >
                              Save tags
                            </button>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Saving re-runs the classifier, so risk and review status update with it.
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => patch(b.id, { review_status: 'approved' })}
                            className="px-3 py-2 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 rounded-lg text-sm hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => patch(b.id, { review_status: 'rejected' })}
                            className="px-3 py-2 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg text-sm hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => patch(b.id, { active: !b.active })}
                            className="px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            {b.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 text-gray-700 dark:text-gray-300"
          >
            Previous
          </button>
          <span className="text-gray-500 dark:text-gray-400">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 text-gray-700 dark:text-gray-300"
          >
            Next
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}
