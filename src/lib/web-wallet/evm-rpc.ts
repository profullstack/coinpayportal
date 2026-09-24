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

/** The EVM chains this portal prepares and broadcasts natively. */
export type EvmBaseChain = 'ETH' | 'POL' | 'BASE';

/**
 * Keyless public endpoints, tried in order after whatever is configured.
 *
 * These are deliberately not the same operator twice: a fallback that shares
 * an outage with the thing it is backing up is not a fallback.
 */
export const EVM_FALLBACK_RPCS: Record<EvmBaseChain, readonly string[]> = {
  ETH: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
  POL: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
  BASE: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
};

/** Which env var names the preferred endpoint for each base chain. */
const CONFIGURED_RPC_ENV: Record<EvmBaseChain, string> = {
  ETH: 'ETHEREUM_RPC_URL',
  POL: 'POLYGON_RPC_URL',
  BASE: 'BASE_RPC_URL',
};

/**
 * Map any EVM wallet chain (including the ERC-20 variants) to its base chain.
 * `USDC_ETH` settles on Ethereum, so it uses Ethereum's RPC list.
 *
 * BASE is tested before ETH deliberately. These are substring matches, and
 * sending Base traffic to an Ethereum endpoint would not fail loudly — it
 * would read a nonce from the wrong chain.
 */
export function evmBaseChain(chain: string): EvmBaseChain {
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
  const configured = process.env[CONFIGURED_RPC_ENV[base]];

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
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      });
    } catch (err: any) {
      attempts.push(`${rpcHost(url)} → ${err?.message || 'network error'}`);
      continue;
    }

    if (!resp.ok) {
      attempts.push(`${rpcHost(url)} → HTTP ${resp.status}`);
      continue;
    }

    try {
      return (await resp.json()) as JsonRpcResponse<T>;
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
