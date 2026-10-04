'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Plaid Link, loaded on demand.
 *
 * Link is a script plus an iframe served from cdn.plaid.com, so both are
 * allowlisted in the CSP (`script-src` and `frame-src` in next.config.mjs).
 * Without the `frame-src` entry the script loads, `open()` resolves, and
 * nothing appears — the iframe is blocked by `default-src` with no error the
 * user can act on.
 *
 * Loaded lazily rather than in the page shell: most visits to /finances never
 * link anything, and this is a third-party script on an authenticated money
 * page. It arrives when someone actually asks to connect a bank.
 */

const PLAID_SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}

interface PlaidGlobal {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void;
    onExit: (error: { display_message?: string; error_message?: string } | null) => void;
  }) => PlaidHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

/** Resolves once the Link script has defined `window.Plaid`. */
let scriptPromise: Promise<PlaidGlobal> | null = null;

function loadPlaidScript(): Promise<PlaidGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Plaid Link is browser-only'));
  }
  if (window.Plaid) return Promise.resolve(window.Plaid);

  // Memoised so two buttons on the same page cannot inject two copies.
  if (!scriptPromise) {
    scriptPromise = new Promise<PlaidGlobal>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_SCRIPT_SRC}"]`);
      const script = existing ?? document.createElement('script');

      const onLoad = () => {
        if (window.Plaid) resolve(window.Plaid);
        // The usual cause is a CSP that allows the script but not the frame,
        // or an extension blocking it. Say so rather than "undefined".
        else reject(new Error('Plaid Link loaded but did not initialise'));
      };

      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener(
        'error',
        () => {
          scriptPromise = null; // let a later attempt retry
          reject(new Error('Could not load Plaid Link'));
        },
        { once: true },
      );

      if (!existing) {
        script.src = PLAID_SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }

  return scriptPromise;
}

export interface UsePlaidLinkOptions {
  /**
   * The page's own header builder, passed in rather than rebuilt here so the
   * two cannot drift apart — a hook that quietly guessed the wrong storage key
   * would 401 on every link with no clue why.
   */
  authHeaders: (extra?: HeadersInit) => HeadersInit;
  /** Called after the connection has been stored server-side. */
  onLinked: (institutionName: string | null) => void | Promise<void>;
  onError: (message: string) => void;
}

export interface UsePlaidLink {
  open: () => void;
  /** True from the moment the button is pressed until Link is on screen. */
  starting: boolean;
}

/**
 * Drive the whole link: mint a token, open Link, exchange the result.
 *
 * The public token Link hands back is short-lived and useless on its own; the
 * durable credential is created server-side by the exchange route and never
 * reaches this component.
 */
export function usePlaidLink({ authHeaders, onLinked, onError }: UsePlaidLinkOptions): UsePlaidLink {
  const [starting, setStarting] = useState(false);
  const handlerRef = useRef<PlaidHandler | null>(null);

  // Link leaves an iframe and listeners behind; drop them if the page unmounts
  // while it is open.
  useEffect(() => {
    return () => {
      handlerRef.current?.destroy();
      handlerRef.current = null;
    };
  }, []);

  const open = useCallback(() => {
    let cancelled = false;
    setStarting(true);

    (async () => {
      try {
        const [plaid, tokenResponse] = await Promise.all([
          loadPlaidScript(),
          fetch('/api/finances/plaid/link-token', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
          }),
        ]);

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
          onError(tokenData.error || 'Could not start a Plaid link.');
          return;
        }
        if (cancelled) return;

        handlerRef.current?.destroy();
        handlerRef.current = plaid.create({
          token: tokenData.linkToken,
          onSuccess: (publicToken, metadata) => {
            void (async () => {
              try {
                const res = await fetch('/api/finances/plaid/exchange', {
                  method: 'POST',
                  headers: authHeaders({ 'Content-Type': 'application/json' }),
                  body: JSON.stringify({
                    publicToken,
                    label: metadata?.institution?.name ?? undefined,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  onError(data.error || 'Could not finish the Plaid link.');
                  return;
                }
                await onLinked(data.connection?.label ?? null);
              } catch {
                onError('Network error finishing the Plaid link.');
              }
            })();
          },
          onExit: (error) => {
            // A plain cancel reports no error, and is not worth a message.
            if (error) onError(error.display_message || error.error_message || 'Plaid link cancelled.');
          },
        });

        handlerRef.current.open();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Could not open Plaid Link.');
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authHeaders, onLinked, onError]);

  return { open: () => void open(), starting };
}
