/**
 * Explorer entry points: one call per thing a page renders, plus the search
 * classifier that decides where a pasted string should go.
 */

import { getChain } from './chains';
import { getUtxoAddress, getUtxoBlock, getUtxoTipHeight, getUtxoTransaction } from './adapters/utxo';
import { getEvmAddress, getEvmBlock, getEvmTipHeight, getEvmTransaction } from './adapters/evm';
import { getMiscAddress, getMiscBlock, getMiscTipHeight, getMiscTransaction } from './adapters/misc';
import { getUsdRate } from './price';
import {
  addressTtl,
  blockTtl,
  remember,
  resultCacheKey,
  transactionTtl,
} from './result-cache';
import { NotFoundError } from './types';
import type { ExplorerAddress, ExplorerBlock, ExplorerTransaction } from './types';

export * from './types';
export { EXPLORER_CHAINS, getChain } from './chains';
export { getUsdRate, getUsdRates, toUsd, formatUsd, formatUnitPrice } from './price';

function familyOf(chainId: string): 'utxo' | 'evm' | 'solana' | 'xrp' | 'cardano' {
  const chain = getChain(chainId);
  if (!chain) throw new NotFoundError(`Unknown chain: ${chainId}`);
  return chain.family;
}

/*
 * The three reads a page makes are cached here rather than in each adapter.
 *
 * rpc-cache.ts covers the EVM adapter by keying on Ethereum method names,
 * which the other two families have no equivalent of -- utxo fetches REST from
 * Blockstream and Blockchair, misc posts Solana RPC, XRP's envelope and Koios
 * REST. Wrapping at this level is one place instead of three key schemes, and
 * the finality signal it reads (`status`, `confirmations`) lives on the domain
 * object, which is a sounder thing to judge immutability by than a method
 * name. See result-cache.ts, including what this deliberately does not fix.
 */

export async function getTransaction(
  chainId: string,
  hash: string
): Promise<ExplorerTransaction> {
  const family = familyOf(chainId);
  return remember(
    resultCacheKey(chainId, 'tx', hash),
    () => {
      if (family === 'utxo') return getUtxoTransaction(chainId, hash);
      if (family === 'evm') return getEvmTransaction(chainId, hash);
      return getMiscTransaction(chainId, hash);
    },
    transactionTtl
  );
}

export async function getAddress(chainId: string, address: string): Promise<ExplorerAddress> {
  const family = familyOf(chainId);
  return remember(
    resultCacheKey(chainId, 'address', address),
    () => {
      if (family === 'utxo') return getUtxoAddress(chainId, address);
      if (family === 'evm') return getEvmAddress(chainId, address);
      return getMiscAddress(chainId, address);
    },
    addressTtl
  );
}

export async function getBlock(chainId: string, ref: string): Promise<ExplorerBlock> {
  const family = familyOf(chainId);
  return remember(
    resultCacheKey(chainId, 'block', ref),
    () => {
      if (family === 'utxo') return getUtxoBlock(chainId, ref);
      if (family === 'evm') return getEvmBlock(chainId, ref);
      return getMiscBlock(chainId, ref);
    },
    blockTtl
  );
}

/** Current tip height for a chain. */
export async function getTipHeight(chainId: string): Promise<number> {
  const family = familyOf(chainId);
  if (family === 'utxo') return getUtxoTipHeight(chainId);
  if (family === 'evm') return getEvmTipHeight(chainId);
  return getMiscTipHeight(chainId);
}

export interface ChainOverview {
  chainId: string;
  /** Null when the chain could not be reached. */
  tipHeight: number | null;
  /** The tip block, when it could be loaded. */
  latestBlock: ExplorerBlock | null;
  usdRate: number | null;
  error?: string;
}

/**
 * Everything the chain landing page shows: where the chain is, what its
 * newest block holds, and what its asset is worth.
 *
 * Each part is allowed to fail on its own. A chain whose node is down still
 * renders with a price, and a rate provider outage still leaves the block
 * data readable — the alternative is one slow upstream blanking the page.
 */
export async function getChainOverview(
  chainId: string,
  opts: { withBlock?: boolean } = {}
): Promise<ChainOverview> {
  const [heightResult, rateResult] = await Promise.allSettled([
    getTipHeight(chainId),
    getUsdRate(chainId),
  ]);

  const tipHeight = heightResult.status === 'fulfilled' ? heightResult.value : null;
  const usdRate = rateResult.status === 'fulfilled' ? rateResult.value : null;

  let latestBlock: ExplorerBlock | null = null;
  if (opts.withBlock && tipHeight !== null) {
    try {
      latestBlock = await getBlock(chainId, String(tipHeight));
    } catch {
      latestBlock = null;
    }
  }

  return {
    chainId,
    tipHeight,
    latestBlock,
    usdRate,
    error:
      heightResult.status === 'rejected'
        ? heightResult.reason instanceof Error
          ? heightResult.reason.message
          : String(heightResult.reason)
        : undefined,
  };
}

// ── Search ──────────────────────────────────────────────────────────────────

export type SearchKind = 'tx' | 'address' | 'block';

export interface SearchCandidate {
  chainId: string;
  kind: SearchKind;
  /** The normalized value to look up. */
  value: string;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Classify a pasted string into everywhere it could plausibly point.
 *
 * Several formats are genuinely ambiguous — a 64-character hex string is a
 * valid transaction hash on six of these chains, and the four EVM networks
 * share an address format outright — so this returns every candidate rather
 * than guessing one. The search page offers the list when it holds more than
 * one entry, which is honest about the ambiguity instead of silently picking
 * Ethereum and showing "not found".
 */
export function classifySearch(raw: string): SearchCandidate[] {
  const q = raw.trim();
  if (!q) return [];

  const evmChains = ['eth', 'pol', 'bnb', 'base'];

  if (EVM_HASH.test(q)) {
    return evmChains.map((chainId) => ({ chainId, kind: 'tx' as const, value: q.toLowerCase() }));
  }

  if (EVM_ADDRESS.test(q)) {
    return evmChains.map((chainId) => ({
      chainId,
      kind: 'address' as const,
      value: q.toLowerCase(),
    }));
  }

  // Cardano and Bitcoin Cash carry their own unmistakable prefixes.
  if (/^addr1[a-z0-9]+$/i.test(q)) return [{ chainId: 'ada', kind: 'address', value: q }];
  if (/^(bitcoincash:)?[qp][a-z0-9]{40,}$/i.test(q)) {
    return [{ chainId: 'bch', kind: 'address', value: q.replace(/^bitcoincash:/i, '') }];
  }

  // Bitcoin: bech32, or base58 starting 1 or 3.
  if (/^(bc1)[a-z0-9]{20,}$/i.test(q)) return [{ chainId: 'btc', kind: 'address', value: q }];
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(q)) {
    // A legacy Bitcoin address is also a valid Bitcoin Cash address, since
    // Bitcoin Cash inherited the format at the fork.
    return [
      { chainId: 'btc', kind: 'address', value: q },
      { chainId: 'bch', kind: 'address', value: q },
    ];
  }

  // Dogecoin addresses start with D and are 34 characters.
  if (/^D[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(q)) {
    return [{ chainId: 'doge', kind: 'address', value: q }];
  }

  // XRP classic addresses start with r.
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(q)) {
    return [{ chainId: 'xrp', kind: 'address', value: q }];
  }

  if (HEX64.test(q)) {
    // Shared by every non-EVM chain here. XRP writes its hashes uppercase,
    // so it leads when the input is uppercase.
    const order =
      q === q.toUpperCase() ? ['xrp', 'btc', 'bch', 'doge', 'ada'] : ['btc', 'bch', 'doge', 'ada', 'xrp'];
    return order.map((chainId) => ({ chainId, kind: 'tx' as const, value: q }));
  }

  // A bare number is a block height on any chain.
  if (/^\d+$/.test(q)) {
    return ['btc', 'bch', 'doge', 'eth', 'pol', 'bnb', 'base', 'sol', 'xrp', 'ada'].map(
      (chainId) => ({ chainId, kind: 'block' as const, value: q })
    );
  }

  // Solana signatures are base58 and long; its addresses are base58 and 32-44.
  if (BASE58.test(q) && q.length >= 60) return [{ chainId: 'sol', kind: 'tx', value: q }];
  if (BASE58.test(q) && q.length >= 32 && q.length <= 44) {
    return [{ chainId: 'sol', kind: 'address', value: q }];
  }

  return [];
}

/** Path a candidate resolves to. */
export function searchHref(c: SearchCandidate): string {
  return `/explorer/${c.chainId}/${c.kind}/${encodeURIComponent(c.value)}`;
}
