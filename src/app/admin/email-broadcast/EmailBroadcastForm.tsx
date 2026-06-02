'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function EmailBroadcastForm() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/email-broadcast')
      .then(r => r.json())
      .then(d => setCount(d.count))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Send "${subject}" to ${count ?? '?'} recipients?`)) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const html = body.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('');
      const res = await fetch('/api/admin/email-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, html, text: body }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      setResult(data);
      setSubject('');
      setBody('');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      {error ? (
        <div className="mb-4 rounded border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {result ? (
        <div className="mb-4 rounded border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-300">
          Sent {result.sent} email{result.sent !== 1 ? 's' : ''}.
          {result.failed > 0 ? ` ${result.failed} failed.` : ''}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid gap-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-white" htmlFor="subject">
            Subject
          </label>
          <input
            id="subject"
            type="text"
            required
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="w-full rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none"
            placeholder="Email subject line"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-white" htmlFor="body">
            Body
          </label>
          <textarea
            id="body"
            required
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={10}
            className="w-full rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none"
            placeholder="Write your message here. Each line will become a paragraph."
          />
          <p className="mt-1 text-xs text-gray-400">
            Each non-empty line will be wrapped in a &lt;p&gt; tag.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            {count !== null
              ? `Will send to ${count} recipient${count !== 1 ? 's' : ''}`
              : 'Loading recipient count…'}
          </p>
          <div className="flex gap-3">
            <Link
              href="/admin"
              className="rounded border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-gray-300 hover:bg-slate-800"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !subject || !body}
              className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send broadcast'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
