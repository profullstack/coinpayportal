/**
 * EVM chains: Ethereum, Polygon, BNB Chain and Base.
 *
 * Blocks and transactions come from plain JSON-RPC, which every one of these
 * networks serves keyless. Address history does not: there is no
 * `eth_getTransactionsByAddress` RPC method, which is the entire reason
 * Etherscan exists. So history needs the Etherscan V2 API, whose single key
 * covers all four chains via the `chainid` parameter.
 *
 * Without a key the balance still resolves and history reports itself as
 * unavailable, rather than rendering an empty list that would read as "this
 * address has never been used".
 */

import { fetchWithTimeout } from '@/lib/http/fetch-timeout';
import { EVM_CHAIN_IDS, evmRpcUrl } from '../chains';
import { NotFoundError, UpstreamError } from '../types';
import type { ExplorerAddress, ExplorerBlock, ExplorerTransaction } from '../types';
import { fromBaseUnits, fromHex } from '../units';
import { explorerCacheKey, readCache, ttlFor, writeCache, writeCacheError } from '../rpc-cache';

const MAX_TXS = 25;
const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';

/**
 * One JSON-RPC read, served from cache when it can be.
 *
 * `/explorer` is public, unauthenticated and `force-dynamic`, so before this
 * every page view went to the upstream node — and a transaction page is three
 * calls. A hundred requests for the same hash cost a hundred lookups. Since
 * most of what the explorer serves is immutable once mined, the cache turns
 * repeat traffic into a single upstream call; see `ttlFor` for which reads are
 * held long and which are not.
 *
 * Rate limiting bounds who may ask; this bounds what asking actually costs.
 * Both are needed: the limiter alone would still let allowed traffic re-query
 * the same immutable block forever.
 */
async function rpc<T>(chainId: string, method: string, params: unknown[]): Promise<T> {
  const key = explorerCacheKey(chainId, method, params);
  const cached = readCache(key); // replays a cached rejection
  if (cached.hit) return cached.value as T;

  let resp: Response;
  try {
    resp = await fetchWithTimeout(evmRpcUrl(chainId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (err) {
    throw new UpstreamError(err instanceof Error ? err.message : String(err));
  }
  if (!resp.ok) {
    await resp.text().catch(() => undefined);
    throw new UpstreamError(`HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new UpstreamError(body.error.message || 'RPC error');
  if (body.result === null || body.result === undefined) {
    // A hash that is not on this chain is the request a scraper repeats, so
    // remember the miss briefly rather than paying for it every time.
    const notFound = new NotFoundError();
    writeCacheError(key, notFound);
    throw notFound;
  }
  writeCache(key, body.result, ttlFor(method, body.result));
  return body.result;
}

interface RpcTx {
  hash: string;
  from?: string;
  to?: string | null;
  value?: string;
  blockNumber?: string | null;
  gasPrice?: string;
}

export async function getEvmTransaction(
  chainId: string,
  hash: string
): Promise<ExplorerTransaction> {
  const tx = await rpc<RpcTx>(chainId, 'eth_getTransactionByHash', [hash]);

  // The receipt carries the success flag and the gas actually burned; a
  // pending transaction has no receipt yet, which is not an error.
  const [receipt, tipHex] = await Promise.all([
    rpc<{ status?: string; gasUsed?: string; effectiveGasPrice?: string } | null>(
      chainId,
      'eth_getTransactionReceipt',
      [hash]
    ).catch(() => null),
    rpc<string>(chainId, 'eth_blockNumber', []).catch(() => null),
  ]);

  const height = tx.blockNumber ? Number(fromHex(tx.blockNumber)) : null;
  const tip = tipHex ? Number(fromHex(tipHex)) : null;

  const gasUsed = fromHex(receipt?.gasUsed);
  const gasPrice = fromHex(receipt?.effectiveGasPrice ?? tx.gasPrice);
  const fee = gasUsed > 0n && gasPrice > 0n ? fromBaseUnits(gasUsed * gasPrice, 18) : null;

  // A receipt status of "0x0" is a transaction that was mined and reverted.
  // It is on chain and it moved gas, so it is neither confirmed nor pending.
  const status: ExplorerTransaction['status'] = !height
    ? 'pending'
    : receipt?.status === '0x0'
      ? 'failed'
      : 'confirmed';

  const amount = fromBaseUnits(fromHex(tx.value), 18);
  return {
    hash: tx.hash,
    chainId,
    status,
    blockHeight: height,
    // eth_getTransactionByHash carries no timestamp; the block holds it, and
    // fetching every block to render a list is not worth the round trips.
    timestamp: null,
    confirmations: height && tip ? Math.max(0, tip - height + 1) : null,
    fee,
    amount,
    transfers: [{ from: tx.from ?? null, to: tx.to ?? null, amount }],
  };
}

/** Height of the chain tip, for the network stats panels. */
export async function getEvmTipHeight(chainId: string): Promise<number> {
  return Number(fromHex(await rpc<string>(chainId, 'eth_blockNumber', [])));
}

export async function getEvmBlock(chainId: string, ref: string): Promise<ExplorerBlock> {
  const isHeight = /^\d+$/.test(ref);
  const block = await rpc<{
    number: string;
    hash: string;
    timestamp?: string;
    transactions?: string[];
  }>(chainId, isHeight ? 'eth_getBlockByNumber' : 'eth_getBlockByHash', [
    isHeight ? `0x${Number(ref).toString(16)}` : ref,
    false,
  ]);

  return {
    chainId,
    height: Number(fromHex(block.number)),
    hash: block.hash,
    timestamp: block.timestamp
      ? new Date(Number(fromHex(block.timestamp)) * 1000).toISOString()
      : null,
    txCount: block.transactions?.length ?? null,
    txHashes: block.transactions?.slice(0, MAX_TXS),
  };
}

interface EtherscanTx {
  hash: string;
  from?: string;
  to?: string;
  value?: string;
  blockNumber?: string;
  timeStamp?: string;
  gasUsed?: string;
  gasPrice?: string;
  isError?: string;
  confirmations?: string;
}

export async function getEvmAddress(chainId: string, address: string): Promise<ExplorerAddress> {
  const balanceHex = await rpc<string>(chainId, 'eth_getBalance', [address, 'latest']);
  const balance = fromBaseUnits(fromHex(balanceHex), 18);

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return {
      address,
      chainId,
      balance,
      txCount: null,
      transactions: [],
      historyUnavailable:
        'Transaction history needs an Etherscan API key (ETHERSCAN_API_KEY); the balance above is live.',
    };
  }

  const url =
    `${ETHERSCAN_V2}?chainid=${EVM_CHAIN_IDS[chainId]}&module=account&action=txlist` +
    `&address=${address}&page=1&offset=${MAX_TXS}&sort=desc&apikey=${apiKey}`;

  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) throw new UpstreamError(`HTTP ${resp.status}`);
    const body = (await resp.json()) as { status?: string; message?: string; result?: unknown };

    // Etherscan signals "no transactions" as status "0" with the message
    // "No transactions found" — an empty result, not a failure. Any other
    // status "0" is a real error (a bad key, or a chain the plan excludes),
    // and must not be shown as an empty history.
    if (body.status !== '1') {
      if (typeof body.message === 'string' && /no transactions found/i.test(body.message)) {
        return { address, chainId, balance, txCount: 0, transactions: [] };
      }
      // On a failure `message` is the useless constant "NOTOK" and the
      // readable reason is in `result` — for these chains it is usually
      // "Free API access is not supported for this chain", since the V2 free
      // tier covers Ethereum and Polygon but not BNB Chain or Base.
      const reason =
        typeof body.result === 'string' && body.result
          ? body.result
          : body.message || 'unknown error';
      return {
        address,
        chainId,
        balance,
        txCount: null,
        transactions: [],
        historyUnavailable: `Transaction history unavailable: ${reason}`,
      };
    }

    const rows = Array.isArray(body.result) ? (body.result as EtherscanTx[]) : [];
    return {
      address,
      chainId,
      balance,
      txCount: rows.length,
      transactions: rows.map((t): ExplorerTransaction => {
        const amount = fromBaseUnits(t.value ?? '0', 18);
        const gas = BigInt(t.gasUsed || '0') * BigInt(t.gasPrice || '0');
        return {
          hash: t.hash,
          chainId,
          status: t.isError === '1' ? 'failed' : 'confirmed',
          blockHeight: t.blockNumber ? Number(t.blockNumber) : null,
          timestamp: t.timeStamp ? new Date(Number(t.timeStamp) * 1000).toISOString() : null,
          confirmations: t.confirmations ? Number(t.confirmations) : null,
          fee: gas > 0n ? fromBaseUnits(gas, 18) : null,
          amount,
          transfers: [{ from: t.from ?? null, to: t.to ?? null, amount }],
        };
      }),
    };
  } catch (err) {
    return {
      address,
      chainId,
      balance,
      txCount: null,
      transactions: [],
      historyUnavailable: `Transaction history unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
