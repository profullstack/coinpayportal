/**
 * EVM JSON-RPC calls with provider failover.
 *
 * One misconfigured provider used to be a platform-wide outage. The Infura
 * project behind `ETHEREUM_RPC_URL` had "require API key secret" switched on
 * while the configured URL carried only the project id, so every single call
 * came back
 *
 *     403  private key only is enabled in Project ID settings
 *
 * and every ETH/POL balance read and send died with it. Nothing failed over,
 * because the endpoint was a single string.
 *
 * So each call now walks a list: the configured endpoint first (operators
 * still control which provider is preferred), then keyless public fallbacks.
 *
 * WHAT COUNTS AS A REASON TO FAIL OVER is the important part. Only TRANSPORT
 * failures do — a network error, or a non-2xx HTTP status. Those mean "this
 * provider is broken", and asking a different one is right.
 *
 * A JSON-RPC error inside a 200 response is NOT a transport failure: that is
 * the chain talking (nonce too low, underpriced, already known, reverted).
 * Every provider would say the same thing, so it is returned to the caller
 * as-is. This distinction matters most for `eth_sendRawTransaction`: retrying
 * a chain-level rejection against another provider would just repeat it, and
 * blindly retrying everything risks resubmitting a transaction.
 *
 * Resubmission is in fact harmless on the transport path — the blob is already
 * signed, so a second provider yields the SAME transaction hash and one of the
 * two answers "already known", which callers treat as success. But that is a
 * property worth stating rather than stumbling into.
 */

import { fetchWithTimeout } from '@/lib/http/fetch-timeout';

/** The EVM chains this portal reads and, except BNB, broadcasts natively. */
export type EvmBaseChain = 'ETH' | 'POL' | 'BASE' | 'BNB';

/**
 * Keyless public endpoints, tried in order after whatever is configured.
 *
 * These are deliberately not the same operator twice: a fallback that shares
 * an outage with the thing it is backing up is not a fallback.
 *
 * publicnode is LAST on purpose. Moving to dev2 (2026-09-25) put all of our
 * polling behind one fixed IP, and publicnode throttled it within a day —
 * every call answered `403 Your access is limited` — so payment detection on
 * every EVM chain stopped while the monitor quietly logged "lookup failed".
 * Each list here was probed from dev2 with the monitor's own calls
 * (eth_getBalance and an ERC-20 balanceOf) before being written down.
 */
export const EVM_FALLBACK_RPCS: Record<EvmBaseChain, readonly string[]> = {
  ETH: [
    'https://eth.drpc.org',
    'https://1rpc.io/eth',
    'https://rpc.mevblocker.io',
    'https://ethereum-rpc.publicnode.com',
  ],
  POL: [
    'https://polygon.drpc.org',
    'https://1rpc.io/matic',
    'https://polygon-bor-rpc.publicnode.com',
  ],
  BASE: ['https://mainnet.base.org', 'https://base.drpc.org', 'https://base-rpc.publicnode.com'],
  BNB: ['https://bsc-dataseed.binance.org', 'https://bsc.drpc.org'],
};

/** Which env vars name the preferred endpoint for each base chain, first set wins. */
const CONFIGURED_RPC_ENV: Record<EvmBaseChain, readonly string[]> = {
  ETH: ['ETHEREUM_RPC_URL'],
  POL: ['POLYGON_RPC_URL'],
  BASE: ['BASE_RPC_URL'],
  BNB: ['BNB_RPC_URL', 'BSC_RPC_URL'],
};

/** A slow provider costs this much before the next one is asked, not the whole cycle. */
const EVM_RPC_TIMEOUT_MS = 10_000;

/**
 * Map any EVM wallet chain (including the ERC-20 variants) to its base chain.
 * `USDC_ETH` settles on Ethereum, so it uses Ethereum's RPC list.
 *
 * BASE is tested before ETH deliberately. These are substring matches, and
 * sending Base traffic to an Ethereum endpoint would not fail loudly — it
 * would read a nonce from the wrong chain.
 */
export function evmBaseChain(chain: string): EvmBaseChain {
  if (chain.includes('BNB') || chain.includes('BSC')) return 'BNB';
  if (chain.includes('BASE')) return 'BASE';
  if (chain.includes('POL')) return 'POL';
  return 'ETH';
}

/**
 * The RPC endpoints to try for `chain`, best first.
 *
 * The configured endpoint leads so that a paid provider keeps serving normal
 * traffic; the public ones exist only to carry us through its bad days.
 */
export function getEvmRpcUrls(chain: string): string[] {
  const base = evmBaseChain(chain);
  const configured = CONFIGURED_RPC_ENV[base]
    .map((name) => process.env[name])
    .find((v) => typeof v === 'string' && v.length > 0);

  const urls = [configured, ...EVM_FALLBACK_RPCS[base]].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );

  // A configured endpoint that already equals a fallback must not be tried twice.
  return Array.from(new Set(urls));
}

/**
 * Host only — never the full URL.
 *
 * A configured RPC URL usually carries an API key in its path (Infura puts the
 * project id there), and these strings end up in logs and in API error bodies.
 */
function rpcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-rpc-url';
  }
}

/** Raised when EVERY provider failed at the transport level. */
export class EvmRpcUnavailableError extends Error {
  constructor(
    readonly chain: string,
    readonly method: string,
    /** One entry per endpoint tried, in order, e.g. `mainnet.infura.io → HTTP 403`. */
    readonly attempts: string[],
  ) {
    super(
      `${chain} RPC unavailable for ${method}: ${attempts.join('; ')}`,
    );
    this.name = 'EvmRpcUnavailableError';
  }
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code?: number; message: string; data?: unknown };
}

/**
 * A JSON-RPC error that is the PROVIDER refusing us, not the chain answering.
 *
 * Some providers report throttling inside a 200 (publicnode sends
 * `-32005 Rate limit exceeded`; Alchemy says "Monthly capacity limit
 * exceeded"). Every other provider would answer that call normally, so it is a
 * reason to fail over, exactly like a 429.
 */
export function isProviderRefusal(error: { code?: number; message?: string } | undefined): boolean {
  if (!error) return false;
  if (error.code === -32005 || error.code === 429) return true;
  return /rate.?limit|capacity|access is limited|api key|not enabled for this app|unauthori[sz]ed|forbidden|daily request count/i.test(
    error.message ?? '',
  );
}

/**
 * Call `method` on the first EVM provider that answers.
 *
 * Returns the parsed JSON-RPC body, INCLUDING a chain-level `error` — callers
 * decide what a rejection means. Throws `EvmRpcUnavailableError` only when no
 * provider could be reached at all.
 */
export async function evmRpcCall<T = string>(
  chain: string,
  method: string,
  params: unknown[] = [],
): Promise<JsonRpcResponse<T>> {
  const urls = getEvmRpcUrls(chain);
  const attempts: string[] = [];

  for (const url of urls) {
    let resp: Response;
    try {
      resp = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        },
        EVM_RPC_TIMEOUT_MS,
      );
    } catch (err: any) {
      attempts.push(`${rpcHost(url)} → ${err?.message || 'network error'}`);
      continue;
    }

    if (!resp.ok) {
      attempts.push(`${rpcHost(url)} → HTTP ${resp.status}`);
      continue;
    }

    try {
      const body = (await resp.json()) as JsonRpcResponse<T>;
      if (isProviderRefusal(body.error)) {
        attempts.push(`${rpcHost(url)} → ${body.error?.message ?? 'refused'}`);
        continue;
      }
      return body;
    } catch {
      // A 200 that is not JSON is a broken provider (or a captive portal), not
      // an answer from the chain — same handling as a bad status.
      attempts.push(`${rpcHost(url)} → non-JSON response`);
    }
  }

  throw new EvmRpcUnavailableError(evmBaseChain(chain), method, attempts);
}

/**
 * `evmRpcCall` for callers that want the result or nothing: a chain-level
 * error is raised rather than returned.
 */
export async function evmRpcResult<T = string>(
  chain: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const body = await evmRpcCall<T>(chain, method, params);
  if (body.error) {
    throw new Error(`${method} failed: ${body.error.message}`);
  }
  return body.result as T;
}
