'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const VIEWPORT = { width: 1280, height: 860 };
const SPECIAL_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']);

type Status = 'connecting' | 'starting' | 'live' | 'saving' | 'saved' | 'cancelled' | 'expired' | 'failed';

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return { ...(extra ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/**
 * The bank, running in CoinPay's cloud browser, on this page: frames come in
 * over Server-Sent Events, clicks and keys go back one request each, in
 * order. What you type goes to the bank's own page in that browser; CoinPay
 * keeps the session the bank issues afterwards, never the password.
 */
export default function CloudBrowserViewer({ liveId }: { liveId: string }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [bank, setBank] = useState<string>('your bank');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ startUrl: string | null } | null>(null);
  const screenRef = useRef<HTMLImageElement | null>(null);
  const keysRef = useRef<HTMLTextAreaElement | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastMove = useRef(0);
  const lastScroll = useRef(0);

  const api = `/api/finances/statements/cloud/live/${encodeURIComponent(liveId)}`;

  const send = useCallback(
    (input: Record<string, unknown>) => {
      queue.current = queue.current
        .then(async () => {
          const res = await fetch(`${api}/input`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(input) });
          if (!res.ok && res.status !== 409) {
            const data = await res.json().catch(() => ({}));
            setError(data?.error?.message ?? 'The browser did not take that input');
          }
        })
        .catch(() => undefined);
    },
    [api],
  );

  // The stream: fetch + a reader, so the Authorization header can go along.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const info = await fetch(api, { headers: authHeaders(), cache: 'no-store' });
        const body = await info.json().catch(() => ({}));
        if (!info.ok) {
          setStatus('failed');
          setError(body?.error?.message ?? 'This sign-in session is not available');
          return;
        }
        setBank(body.live.institutionLabel || body.live.institutionKey);
        setStatus(body.live.status);
        const res = await fetch(`${api}/stream`, { headers: authHeaders(), signal: controller.signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw new Error('stream refused');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const event = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (!event || !data) continue;
            const parsed = JSON.parse(data);
            if (event === 'frame') {
              setFrame(`data:image/jpeg;base64,${parsed.data}`);
              setUrl(parsed.url);
            } else if (event === 'status') {
              setStatus(parsed.status);
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Lost the connection to the browser');
      }
    })();
    return () => controller.abort();
  }, [api]);

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = screenRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * VIEWPORT.width),
      y: Math.round(((e.clientY - rect.top) / rect.height) * VIEWPORT.height),
    };
  };

  const save = async () => {
    setError(null);
    const res = await fetch(`${api}/save`, { method: 'POST', headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? 'Could not save the session');
      return;
    }
    setSaved({ startUrl: data.startUrl ?? null });
    setStatus('saved');
  };

  const cancel = async () => {
    await fetch(api, { method: 'DELETE', headers: authHeaders() }).catch(() => undefined);
    setStatus('cancelled');
  };

  const live = status === 'live';
  const done = ['saved', 'cancelled', 'expired', 'failed'].includes(status);

  return (
    <div className="min-h-screen bg-slate-950 text-gray-100 p-4">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Connect {bank}</h1>
            <p className="text-xs text-gray-400">
              Sign in, then open the page that lists your statements and press Save. You are using CoinPay&apos;s cloud browser: what you type goes to your bank, and CoinPay keeps only the session your bank issues, never your password.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!live} onClick={save} className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
              {status === 'saving' ? 'Saving…' : 'Save — I am on my statements page'}
            </button>
            <button type="button" disabled={done} onClick={cancel} className="rounded border border-slate-600 px-3 py-2 text-sm text-gray-300 disabled:opacity-40">
              Cancel
            </button>
          </div>
        </div>

        <div className="mb-2 flex items-center gap-2">
          <button type="button" disabled={!live} onClick={() => send({ type: 'back' })} className="rounded border border-slate-700 px-2 py-1 text-xs" aria-label="Back">
            ←
          </button>
          <button type="button" disabled={!live} onClick={() => send({ type: 'reload' })} className="rounded border border-slate-700 px-2 py-1 text-xs" aria-label="Reload">
            ⟳
          </button>
          <input
            value={editingUrl ?? url}
            onChange={(e) => setEditingUrl(e.target.value)}
            onFocus={() => setEditingUrl(url)}
            onBlur={() => setEditingUrl(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editingUrl) {
                send({ type: 'navigate', url: editingUrl.includes('://') ? editingUrl : `https://${editingUrl}` });
                setEditingUrl(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={!live}
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-gray-300"
            aria-label="Address"
          />
          <span className="rounded border border-slate-700 px-2 py-1 text-xs text-gray-400">{status}</span>
        </div>

        {error && <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>}

        {saved ? (
          <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
            <p className="font-medium text-emerald-300">Saved. CoinPay is fetching your statements now and will check again every week.</p>
            {saved.startUrl && <p className="mt-1 text-xs text-gray-400">Fetches start at {saved.startUrl}</p>}
            <a href="/finances/statements" className="mt-3 inline-block text-emerald-300 underline">
              Back to statements
            </a>
          </div>
        ) : done ? (
          <div className="rounded border border-slate-700 p-4 text-sm text-gray-300">
            This sign-in session has ended ({status}). <a href="/finances/statements" className="underline">Back to statements</a>
          </div>
        ) : (
          <div className="relative" onClick={() => keysRef.current?.focus()}>
            {frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={screenRef}
                src={frame}
                alt={`${bank} in CoinPay's cloud browser`}
                draggable={false}
                className="w-full select-none rounded border border-slate-700 cursor-pointer"
                style={{ aspectRatio: `${VIEWPORT.width} / ${VIEWPORT.height}` }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  const p = point(e);
                  if (p) send({ type: 'click', ...p, clickCount: e.detail === 2 ? 2 : 1 });
                  keysRef.current?.focus();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const p = point(e);
                  if (p) send({ type: 'click', ...p, button: 'right' });
                }}
                onMouseMove={(e) => {
                  const now = Date.now();
                  if (now - lastMove.current < 120) return;
                  lastMove.current = now;
                  const p = point(e);
                  if (p) send({ type: 'move', ...p });
                }}
                onWheel={(e) => {
                  const now = Date.now();
                  if (now - lastScroll.current < 60) return;
                  lastScroll.current = now;
                  const p = point(e);
                  if (p) send({ type: 'scroll', ...p, dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) });
                }}
              />
            ) : (
              <div className="flex items-center justify-center rounded border border-slate-700 text-sm text-gray-500" style={{ aspectRatio: `${VIEWPORT.width} / ${VIEWPORT.height}` }}>
                Starting the browser…
              </div>
            )}
            <textarea
              ref={keysRef}
              aria-label="Keyboard input for the bank page"
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="absolute left-0 top-0 h-px w-px opacity-0"
              onKeyDown={(e) => {
                if (SPECIAL_KEYS.has(e.key) || e.key === ' ') {
                  e.preventDefault();
                  const modifiers = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
                  send({ type: 'key', key: e.key === ' ' ? 'Space' : e.key, modifiers });
                }
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                if (target.value) send({ type: 'text', text: target.value });
                target.value = '';
              }}
            />
            <p className="mt-2 text-xs text-gray-500">Click the page to type. Paste works. The session closes after 10 minutes without activity.</p>
          </div>
        )}
      </div>
    </div>
  );
}
