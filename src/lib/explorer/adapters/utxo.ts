/**
 * UTXO chains: Bitcoin, Bitcoin Cash and Dogecoin.
 *
 * Three chains, three unrelated APIs, because no single free source covers
 * all three. Each was verified answering keyless on 2026-09-07:
 *
 *   BTC   Esplora (blockstream.info) — full address history
 *   BCH   Haskoin                    — full address history
 *   DOGE  BlockCypher                — ~200 requests/day unkeyed, so thin
 *
 * BlockCypher's allowance is the reason DOGE history is capped tighter than
 * the others: one address page costs one of those requests.
 */

import { fetchWithTimeout } from '@/lib/http/fetch-timeout';
import { NotFoundError, UpstreamError } from '../types';
import type { ExplorerAddress, ExplorerBlock, ExplorerTransaction } from '../types';
import { fromBaseUnits, sumBaseUnits } from '../units';

const MAX_TXS = 25;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, init);
  } catch (err) {
    throw new UpstreamError(err instanceof Error ? err.message : String(err));
  }
  if (resp.status === 404) {
    await resp.text().catch(() => undefined);
    throw new NotFoundError();
  }
  if (!resp.ok) {
    await resp.text().catch(() => undefined);
    throw new UpstreamError(`HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

// ── Bitcoin: Esplora ────────────────────────────────────────────────────────

interface EsploraTx {
  txid: string;
  fee?: number;
  vin: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } | null }>;
  vout: Array<{ scriptpubkey_address?: string; value?: number }>;
  status: { confirmed?: boolean; block_height?: number; block_time?: number };
}

function esploraToTx(tx: EsploraTx, tipHeight: number | null): ExplorerTransaction {
  const height = tx.status?.confirmed ? (tx.status.block_height ?? null) : null;
  return {
    hash: tx.txid,
    chainId: 'btc',
    status: tx.status?.confirmed ? 'confirmed' : 'pending',
    blockHeight: height,
    timestamp: tx.status?.block_time ? new Date(tx.status.block_time * 1000).toISOString() : null,
    confirmations: height && tipHeight ? Math.max(0, tipHeight - height + 1) : null,
    fee: tx.fee !== undefined ? fromBaseUnits(tx.fee, 8) : null,
    amount: fromBaseUnits(sumBaseUnits(tx.vout.map((o) => o.value)), 8),
    transfers: tx.vout.map((o) => ({
      from: tx.vin[0]?.prevout?.scriptpubkey_address ?? null,
      to: o.scriptpubkey_address ?? null,
      amount: fromBaseUnits(o.value ?? 0, 8),
    })),
  };
}

async function btcTip(): Promise<number | null> {
  try {
    const resp = await fetchWithTimeout('https://blockstream.info/api/blocks/tip/height');
    if (!resp.ok) return null;
    return parseInt(await resp.text(), 10) || null;
  } catch {
    return null;
  }
}

// ── Bitcoin Cash: Haskoin ───────────────────────────────────────────────────

interface HaskoinTx {
  txid: string;
  fee?: number;
  time?: number;
  block?: { height?: number };
  inputs: Array<{ address?: string | null; value?: number }>;
  outputs: Array<{ address?: string | null; value?: number }>;
}

function haskoinToTx(tx: HaskoinTx, tipHeight: number | null): ExplorerTransaction {
  const height = tx.block?.height ?? null;
  return {
    hash: tx.txid,
    chainId: 'bch',
    status: height ? 'confirmed' : 'pending',
    blockHeight: height,
    timestamp: tx.time ? new Date(tx.time * 1000).toISOString() : null,
    confirmations: height && tipHeight ? Math.max(0, tipHeight - height + 1) : null,
    fee: tx.fee !== undefined ? fromBaseUnits(tx.fee, 8) : null,
    amount: fromBaseUnits(sumBaseUnits((tx.outputs || []).map((o) => o.value)), 8),
    transfers: (tx.outputs || []).map((o) => ({
      from: tx.inputs?.[0]?.address ?? null,
      to: o.address ?? null,
      amount: fromBaseUnits(o.value ?? 0, 8),
    })),
  };
}

async function bchTip(): Promise<number | null> {
  try {
    const best = await getJson<{ height?: number }>('https://api.haskoin.com/bch/block/best?notx=true');
    return best.height ?? null;
  } catch {
    return null;
  }
}

// ── Dogecoin: BlockCypher ───────────────────────────────────────────────────

interface BlockCypherTx {
  hash: string;
  block_height?: number;
  confirmations?: number;
  confirmed?: string;
  received?: string;
  fees?: number;
  inputs: Array<{ addresses?: string[] | null }>;
  outputs: Array<{ addresses?: string[] | null; value?: number }>;
}

function blockcypherToTx(tx: BlockCypherTx): ExplorerTransaction {
  // BlockCypher reports -1 for an unconfirmed transaction's height.
  const height = tx.block_height && tx.block_height > 0 ? tx.block_height : null;
  return {
    hash: tx.hash,
    chainId: 'doge',
    status: height ? 'confirmed' : 'pending',
    blockHeight: height,
    timestamp: tx.confirmed ?? tx.received ?? null,
    confirmations: tx.confirmations ?? null,
    fee: tx.fees !== undefined ? fromBaseUnits(tx.fees, 8) : null,
    amount: fromBaseUnits(sumBaseUnits((tx.outputs || []).map((o) => o.value)), 8),
    transfers: (tx.outputs || []).map((o) => ({
      from: tx.inputs?.[0]?.addresses?.[0] ?? null,
      to: o.addresses?.[0] ?? null,
      amount: fromBaseUnits(o.value ?? 0, 8),
    })),
  };
}

// ── Public surface ──────────────────────────────────────────────────────────

export async function getUtxoTransaction(
  chainId: string,
  hash: string
): Promise<ExplorerTransaction> {
  if (chainId === 'btc') {
    const [tx, tip] = await Promise.all([
      getJson<EsploraTx>(`https://blockstream.info/api/tx/${hash}`),
      btcTip(),
    ]);
    return esploraToTx(tx, tip);
  }
  if (chainId === 'bch') {
    const [tx, tip] = await Promise.all([
      getJson<HaskoinTx>(`https://api.haskoin.com/bch/transaction/${hash}`),
      bchTip(),
    ]);
    return haskoinToTx(tx, tip);
  }
  const tx = await getJson<BlockCypherTx>(`https://api.blockcypher.com/v1/doge/main/txs/${hash}`);
  return blockcypherToTx(tx);
}

export async function getUtxoAddress(chainId: string, address: string): Promise<ExplorerAddress> {
  if (chainId === 'btc') {
    const [info, txs, tip] = await Promise.all([
      getJson<{
        chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number };
      }>(`https://blockstream.info/api/address/${address}`),
      getJson<EsploraTx[]>(`https://blockstream.info/api/address/${address}/txs`).catch(() => []),
      btcTip(),
    ]);
    const funded = BigInt(info.chain_stats?.funded_txo_sum ?? 0);
    const spent = BigInt(info.chain_stats?.spent_txo_sum ?? 0);
    return {
      address,
      chainId,
      balance: fromBaseUnits(funded - spent, 8),
      txCount: info.chain_stats?.tx_count ?? null,
      transactions: txs.slice(0, MAX_TXS).map((t) => esploraToTx(t, tip)),
    };
  }

  if (chainId === 'bch') {
    const [balance, txs, tip] = await Promise.all([
      getJson<{ confirmed?: number; txs?: number }>(
        `https://api.haskoin.com/bch/address/${address}/balance`
      ),
      getJson<HaskoinTx[]>(
        `https://api.haskoin.com/bch/address/${address}/transactions/full?limit=${MAX_TXS}`
      ).catch(() => []),
      bchTip(),
    ]);
    return {
      address,
      chainId,
      balance: fromBaseUnits(balance.confirmed ?? 0, 8),
      txCount: balance.txs ?? null,
      transactions: txs.map((t) => haskoinToTx(t, tip)),
    };
  }

  // DOGE. `/full` returns the transactions inline, saving a request per
  // transaction against an allowance measured in hundreds per day.
  const data = await getJson<{
    balance?: number;
    n_tx?: number;
    txs?: BlockCypherTx[];
  }>(`https://api.blockcypher.com/v1/doge/main/addrs/${address}/full?limit=${MAX_TXS}`);
  return {
    address,
    chainId,
    balance: fromBaseUnits(data.balance ?? 0, 8),
    txCount: data.n_tx ?? null,
    transactions: (data.txs || []).slice(0, MAX_TXS).map(blockcypherToTx),
  };
}

export async function getUtxoBlock(chainId: string, ref: string): Promise<ExplorerBlock> {
  const isHeight = /^\d+$/.test(ref);

  if (chainId === 'btc') {
    let hash = ref;
    if (isHeight) {
      const resp = await fetchWithTimeout(`https://blockstream.info/api/block-height/${ref}`);
      if (resp.status === 404) throw new NotFoundError();
      if (!resp.ok) throw new UpstreamError(`HTTP ${resp.status}`);
      // This endpoint answers with a bare hash as plain text, not JSON.
      hash = (await resp.text()).trim();
    }
    const block = await getJson<{
      id: string;
      height: number;
      timestamp?: number;
      tx_count?: number;
    }>(`https://blockstream.info/api/block/${hash}`);
    return {
      chainId,
      height: block.height,
      hash: block.id,
      timestamp: block.timestamp ? new Date(block.timestamp * 1000).toISOString() : null,
      txCount: block.tx_count ?? null,
    };
  }

  if (chainId === 'bch') {
    const path = isHeight ? `height/${ref}` : `${ref}`;
    const raw = await getJson<
      | { hash: string; height: number; time?: number; tx?: string[] }
      | Array<{ hash: string; height: number; time?: number; tx?: string[] }>
    >(`https://api.haskoin.com/bch/block/${path}`);
    // Lookup by height answers with an array (a height can have orphans);
    // lookup by hash answers with the object itself.
    const block = Array.isArray(raw) ? raw[0] : raw;
    if (!block) throw new NotFoundError();
    return {
      chainId,
      height: block.height,
      hash: block.hash,
      timestamp: block.time ? new Date(block.time * 1000).toISOString() : null,
      txCount: block.tx?.length ?? null,
      txHashes: block.tx?.slice(0, MAX_TXS),
    };
  }

  const block = await getJson<{
    hash: string;
    height: number;
    time?: string;
    n_tx?: number;
    txids?: string[];
  }>(`https://api.blockcypher.com/v1/doge/main/blocks/${ref}`);
  return {
    chainId,
    height: block.height,
    hash: block.hash,
    timestamp: block.time ?? null,
    txCount: block.n_tx ?? null,
    txHashes: block.txids?.slice(0, MAX_TXS),
  };
}
