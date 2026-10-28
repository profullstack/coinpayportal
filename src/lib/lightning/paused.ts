/**
 * Lightning can be switched off without a rebuild (LIGHTNING_PAUSED=1 in the
 * app env): the node was emptied on 2026-10-27 and runs with no channels, so
 * every invoice, Lightning address and zap would fail or strand funds.
 *
 * Read at request time on purpose: Next inlines `process.env.NAME` at build,
 * a computed key it cannot.
 */
const env = (name: string) => process.env[name];

export function lightningPaused(): boolean {
  return /^(1|true|yes|on)$/i.test(env('LIGHTNING_PAUSED') ?? '');
}

/** Paths that need a working Lightning node. */
export function isLightningPath(path: string): boolean {
  return (
    path === '/api/lightning' ||
    path.startsWith('/api/lightning/') ||
    path.startsWith('/.well-known/lnurlp/') ||
    path === '/lnurlp' ||
    path.startsWith('/lnurlp/')
  );
}

export const LIGHTNING_PAUSED_MESSAGE =
  'Lightning is paused on CoinPay while the node is rebuilt. On-chain payments work as normal.';
