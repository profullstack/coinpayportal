/**
 * Normalized shapes the explorer renders.
 *
 * Ten networks across five very different node APIs answer with ten different
 * schemas. The pages only ever see what is below, so adding a chain means
 * writing one adapter rather than touching the UI.
 *
 * Amounts are decimal strings in the chain's own unit, already scaled out of
 * satoshis/wei/lamports/drops. They are strings because a number cannot hold
 * 18 decimals of wei without losing the low digits, and the low digits are the
 * part a reader is checking.
 */

/** A network the explorer can read. */
export interface ExplorerChain {
  /** URL segment, e.g. "btc". */
  id: string;
  /** Display name, e.g. "Bitcoin". */
  name: string;
  /** Ticker shown next to amounts. */
  symbol: string;
  /** Which adapter serves it. */
  family: 'utxo' | 'evm' | 'solana' | 'xrp' | 'cardano';
  /** Decimal places the native unit carries, for display. */
  decimals: number;
}

export interface ExplorerTransfer {
  from: string | null;
  to: string | null;
  /** Decimal string in the chain's native unit. */
  amount: string;
}

export interface ExplorerTransaction {
  hash: string;
  chainId: string;
  status: 'confirmed' | 'pending' | 'failed';
  /** Null while the transaction is still in the mempool. */
  blockHeight: number | null;
  /** ISO-8601, or null when the source does not report a time. */
  timestamp: string | null;
  confirmations: number | null;
  /** Decimal string, or null where the chain does not expose a flat fee. */
  fee: string | null;
  /** Total moved, summed over outputs on UTXO chains. */
  amount: string;
  transfers: ExplorerTransfer[];
}

export interface ExplorerAddress {
  address: string;
  chainId: string;
  /** Confirmed balance, decimal string in the native unit. */
  balance: string;
  /** Total transactions seen, where the source reports it. */
  txCount: number | null;
  /** Most recent first. May be empty even for a funded address — see notes. */
  transactions: ExplorerTransaction[];
  /**
   * Set when history could not be listed but the balance is real — an EVM
   * chain with no Etherscan key, for instance. The page says so rather than
   * showing an empty list, which would read as "no activity".
   */
  historyUnavailable?: string;
}

export interface ExplorerBlock {
  chainId: string;
  height: number;
  hash: string;
  timestamp: string | null;
  txCount: number | null;
  /** Hashes of the transactions in the block, where cheaply available. */
  txHashes?: string[];
}

/** Raised by adapters so routes can tell "no such thing" from "source down". */
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Raised when the upstream source failed, as opposed to answering "absent". */
export class UpstreamError extends Error {
  constructor(message = 'Upstream unavailable') {
    super(message);
    this.name = 'UpstreamError';
  }
}
