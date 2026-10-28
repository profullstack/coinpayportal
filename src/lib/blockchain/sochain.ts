import { fetchWithTimeout } from '@/lib/http/fetch-timeout';

/**
 * SoChain API v3 client for UTXO-chain reads (balance, transactions,
 * unspent outputs, transaction status). Docs: https://sochain.com/docs
 *
 * Read-only: SoChain does not broadcast, so sending stays with each provider's
 * own broadcaster.
 *
 * Keyless works (a daily per-IP allowance). For more, set `SOCHAIN_API_KEY`
 * (free or paid key from https://sochain.com/dashboard); it is sent as the
 * `API-KEY` header.
 *
 * Amounts arrive as decimal strings in whole coins ("62222.06467666"). They are
 * parsed to integer satoshis as BigInt, never through a float multiply.
 */

export const SOCHAIN_API_BASE = 'https://sochain.com/api/v3';

/** Networks this client is used for. SoChain also serves BTC, LTC and ZEC. */
export type SoChainNetwork = 'DOGE';

const COIN_DECIMALS = 8;
const SATOSHIS_PER_COIN = BigInt(10) ** BigInt(COIN_DECIMALS);
const COIN_AMOUNT = /^(\d+)(?:\.(\d{1,8}))?$/;

/**
 * Exact integer satoshis from a SoChain amount string.
 * Throws on anything that is not a plain non-negative decimal with at most 8
 * places, so a malformed answer can never read as a balance.
 */
export function coinsToSatoshis(value: unknown): bigint {
  if (typeof value !== 'string') throw new Error('Invalid SoChain amount');
  const match = COIN_AMOUNT.exec(value);
  if (!match) throw new Error('Invalid SoChain amount');
  const fraction = (match[2] || '').padEnd(COIN_DECIMALS, '0');
  return BigInt(match[1]) * SATOSHIS_PER_COIN + BigInt(fraction);
}

/** Like coinsToSatoshis, but allows a leading minus (balance changes). */
export function signedCoinsToSatoshis(value: unknown): bigint {
  if (typeof value === 'string' && value.startsWith('-')) return -coinsToSatoshis(value.slice(1));
  return coinsToSatoshis(value);
}

/** Satoshis as a whole-coin decimal string, trailing zeros trimmed ("1.5", "0"). */
export function satoshisToCoins(satoshis: bigint): string {
  const negative = satoshis < BigInt(0);
  const abs = negative ? -satoshis : satoshis;
  const whole = abs / SATOSHIS_PER_COIN;
  const fraction = (abs % SATOSHIS_PER_COIN).toString().padStart(COIN_DECIMALS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Satoshis as a coin-denominated number, for callers that compare numbers. */
export function satoshisToNumber(satoshis: bigint): number {
  return Number(satoshisToCoins(satoshis));
}

function sochainHeaders(): Record<string, string> {
  const apiKey = process.env.SOCHAIN_API_KEY?.trim();
  return apiKey ? { 'API-KEY': apiKey } : {};
}

/**
 * GET a SoChain v3 path and return its `data`.
 *
 * Throws on a non-2xx answer (401: bad key; 429: rate-limited, with
 * Retry-After when given; 404: unknown address or transaction) and on a
 * `status: "fail"` body, so callers never read a failure as zero.
 */
export async function sochainGet<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(`${SOCHAIN_API_BASE}${path}`, {
    headers: { Accept: 'application/json', ...sochainHeaders() },
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body; reported below by status.
  }

  if (!response.ok || body?.status !== 'success' || body?.data == null) {
    const reason = body?.data?.error_message || `HTTP ${response.status}`;
    const retryAfter = response.status === 429 ? response.headers?.get?.('retry-after') : null;
    throw new Error(
      `SoChain ${path} failed: ${reason}${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`
    );
  }
  return body.data as T;
}

const seg = (value: string) => encodeURIComponent(value);

export interface SoChainBalance {
  /** Confirmed balance in satoshis. */
  confirmed: bigint;
  /** Pending change from the mempool in satoshis (may be negative). */
  unconfirmed: bigint;
}

export async function getSoChainBalance(network: SoChainNetwork, address: string): Promise<SoChainBalance> {
  const data = await sochainGet<{ confirmed?: unknown; unconfirmed?: unknown }>(
    `/balance/${network}/${seg(address)}`
  );
  return {
    confirmed: coinsToSatoshis(data.confirmed),
    unconfirmed: signedCoinsToSatoshis(data.unconfirmed ?? '0'),
  };
}

export interface SoChainAddressTransaction {
  hash: string;
  /** Net change to the address's balance, in satoshis (negative for a send). */
  balanceChange: bigint;
  /** Block height, or null while unconfirmed. */
  block: number | null;
  /** Unix seconds. */
  time: number | null;
}

/** One page (10) of an address's transactions: unconfirmed first, then newest first. */
export async function getSoChainTransactions(
  network: SoChainNetwork,
  address: string,
  page = 1
): Promise<SoChainAddressTransaction[]> {
  const data = await sochainGet<{ transactions?: any[] }>(
    `/transactions/${network}/${seg(address)}${page > 1 ? `/${page}` : ''}`
  );
  if (!Array.isArray(data.transactions)) throw new Error('Invalid SoChain transactions response');
  return data.transactions.map((tx) => {
    if (typeof tx?.hash !== 'string') throw new Error('Invalid SoChain transaction row');
    return {
      hash: tx.hash,
      balanceChange: signedCoinsToSatoshis(tx.balance_change),
      block: typeof tx.block === 'number' ? tx.block : null,
      time: typeof tx.time === 'number' ? tx.time : null,
    };
  });
}

export interface SoChainUnspentOutput {
  txid: string;
  vout: number;
  /** Satoshis. */
  value: bigint;
  scriptPubKey: string;
  /** Block height, or null while unconfirmed. */
  block: number | null;
  /** The funding transaction, for signing legacy inputs (nonWitnessUtxo). */
  txHex?: string;
}

const UNSPENT_PAGE_SIZE = 10;

/** An address's unspent outputs, oldest first, following pages up to `maxPages`. */
export async function getSoChainUnspentOutputs(
  network: SoChainNetwork,
  address: string,
  maxPages = 20
): Promise<SoChainUnspentOutput[]> {
  const outputs: SoChainUnspentOutput[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await sochainGet<{ outputs?: any[] }>(
      `/unspent_outputs/${network}/${seg(address)}${page > 1 ? `/${page}` : ''}`
    );
    if (!Array.isArray(data.outputs)) throw new Error('Invalid SoChain unspent_outputs response');
    for (const out of data.outputs) {
      if (typeof out?.hash !== 'string' || !Number.isSafeInteger(out?.index)) {
        throw new Error('Invalid SoChain unspent output');
      }
      outputs.push({
        txid: out.hash,
        vout: out.index,
        value: coinsToSatoshis(out.value),
        scriptPubKey: typeof out.script === 'string' ? out.script : '',
        block: typeof out.block === 'number' ? out.block : null,
        txHex: typeof out.tx_hex === 'string' ? out.tx_hex : undefined,
      });
    }
    if (data.outputs.length < UNSPENT_PAGE_SIZE) return outputs;
  }
  throw new Error(`SoChain unspent_outputs for ${address} exceeds ${maxPages} pages`);
}

export interface SoChainTransaction {
  hash: string;
  confirmations: number;
  blockHeight: number | null;
  time: number | null;
  inputs: Array<{ address: string | null; value: bigint }>;
  outputs: Array<{ address: string | null; value: bigint }>;
  fee: bigint;
}

export async function getSoChainTransaction(network: SoChainNetwork, hash: string): Promise<SoChainTransaction> {
  const tx = await sochainGet<any>(`/transaction/${network}/${seg(hash)}`);
  if (typeof tx?.hash !== 'string' || !Array.isArray(tx.inputs) || !Array.isArray(tx.outputs)) {
    throw new Error('Invalid SoChain transaction response');
  }
  const io = (rows: any[]) =>
    rows.map((row) => ({
      address: typeof row?.address === 'string' ? row.address : null,
      value: coinsToSatoshis(row?.value),
    }));
  return {
    hash: tx.hash,
    confirmations: Number.isSafeInteger(tx.confirmations) ? tx.confirmations : 0,
    blockHeight: typeof tx.block_height === 'number' ? tx.block_height : null,
    time: typeof tx.time === 'number' ? tx.time : null,
    inputs: io(tx.inputs),
    outputs: io(tx.outputs),
    fee: coinsToSatoshis(tx.fee ?? '0'),
  };
}

export type SoChainTxState = 'pending' | 'mined' | 'replaced' | 'dropped' | 'unknown';

export interface SoChainTransactionStatus {
  status: SoChainTxState;
  confirmations: number;
  blockHeight: number | null;
  replacedBy: string | null;
}

/** Whether a transaction is pending, mined, replaced or dropped. */
export async function getSoChainTransactionStatus(
  network: SoChainNetwork,
  hash: string
): Promise<SoChainTransactionStatus> {
  const data = await sochainGet<any>(`/transaction_status/${network}/${seg(hash)}`);
  const known: SoChainTxState[] = ['pending', 'mined', 'replaced', 'dropped', 'unknown'];
  if (!known.includes(data?.status)) throw new Error('Invalid SoChain transaction_status response');
  return {
    status: data.status,
    confirmations: Number.isSafeInteger(data.confirmations) ? data.confirmations : 0,
    blockHeight: typeof data.block_height === 'number' ? data.block_height : null,
    replacedBy: typeof data.replaced_by === 'string' ? data.replaced_by : null,
  };
}
