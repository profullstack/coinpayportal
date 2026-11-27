/**
 * Replay identity for v1 x402 proofs, shared by `/api/x402/verify` and
 * `/api/x402/settle` so the two routes always derive the same key.
 *
 * The key used to be `nonce || txId || txSignature || preimage ||
 * paymentIntentId` on every rail except Nano. On Solana, Bitcoin, Lightning and
 * Stripe the `nonce` is an unauthenticated JSON field the payer writes, so one
 * real payment presented with `nonce: "1"`, `"2"`, `"3"` ... produced a fresh
 * ledger row each time, and each row settled against the same transaction
 * (security report CPP-03, 2026-11-26). Each rail now keys on the one
 * identifier that names the payment itself:
 *
 *   - solana:    txSignature (base58, case-sensitive)
 *   - bitcoin:   txId (hex, lowercased)
 *   - lightning: paymentHash (hex, lowercased; verify checks the preimage hashes to it)
 *   - stripe:    paymentIntentId
 *   - nano:      block hash, canonical case
 *   - EVM v1:    the EIP-712 `nonce`. Here the nonce IS payer-authenticated:
 *                it is inside the signed struct. The on-chain transaction that
 *                pays it is not, which is why settlement also refuses a
 *                `tx_hash` that already paid another row (see `canonicalTxHash`
 *                and the unique index in 20261127000000_x402_tx_hash_unique.sql).
 *
 * Returns null when the proof lacks its rail's identifier; callers must refuse.
 */
import { EVM_NETWORKS, UTXO_NETWORKS } from './networks';
import { normalizeNanoBlockHash } from './nano';

function str(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? String(value).trim()
    : '';
}

export function x402ReplayKey(network: string, payload: Record<string, any> | undefined): string | null {
  if (!payload) return null;
  let key = '';
  if (network === 'nano') key = normalizeNanoBlockHash(payload.blockHash) ?? '';
  else if (network === 'solana') key = str(payload.txSignature);
  else if (UTXO_NETWORKS.has(network)) key = str(payload.txId).toLowerCase();
  else if (network === 'lightning') key = str(payload.paymentHash).toLowerCase();
  else if (network === 'stripe') key = str(payload.paymentIntentId);
  else if (EVM_NETWORKS.has(network)) key = str(payload.nonce);
  return key || null;
}

/**
 * The form a settlement transaction id is stored in, so the same transaction
 * can never be written twice under different casing. Hex ids (EVM, Bitcoin,
 * Lightning) are case-insensitive; Solana signatures and Stripe ids are not.
 */
export function canonicalTxHash(network: string, txHash: string): string {
  const value = txHash.trim();
  if (network === 'solana' || network === 'stripe') return value;
  if (network === 'nano') return value.toUpperCase();
  return value.toLowerCase();
}

/** SPL mints the platform settles, by the symbols a proof may name instead. */
export const SOLANA_MINTS_BY_SYMBOL: Record<string, string> = {
  usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  usdc_sol: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  usdt: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  usdt_sol: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

/**
 * What a recorded Solana asset means for settlement: native SOL (lamports) or
 * one exact SPL mint. `verify` stores `payload.asset || extra.assetSymbol ||
 * network`, so an unnamed asset arrives as "solana".
 */
export function solanaSettlementAsset(asset: unknown): { native: true } | { native: false; mint: string } {
  const raw = str(asset);
  const lower = raw.toLowerCase();
  if (!raw || lower === 'solana' || lower === 'sol' || lower === '0x0000000000000000000000000000000000000000') {
    return { native: true };
  }
  return { native: false, mint: SOLANA_MINTS_BY_SYMBOL[lower] ?? raw };
}
