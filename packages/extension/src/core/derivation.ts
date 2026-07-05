/**
 * Address derivation — reuses the audited `@profullstack/coinpay` SDK so the
 * extension's addresses match the CoinPay web wallet exactly (PRD P0-2).
 *
 * Parity recipe, verified against the SDK source:
 *   seed = bip39.mnemonicToSeedSync(mnemonic.trim())   // no passphrase
 *   address = deriveAddress(seed, chain, index)
 *
 * We call the SDK's `deriveAddress` (pure JS, secp256k1 / SLIP-0010 ed25519 —
 * no WASM) rather than reimplementing it, to guarantee byte-for-byte parity.
 */

import { mnemonicToSeedSync } from '@scure/bip39';
// The SDK exposes `deriveAddress` via its `./wallet` subpath export.
import { deriveAddress } from '@profullstack/coinpay/wallet';

import { CHAINS, DEFAULT_CHAINS, type NativeChain } from './chains.js';

export interface DerivedAddress {
  chain: NativeChain;
  address: string;
  /** Tokens that share this address (e.g. USDC on ETH/POL/SOL). */
  tokens: readonly string[];
}

/**
 * Convert a BIP-39 mnemonic to a raw seed the SDK's derivation expects.
 * Matches the SDK exactly: trimmed mnemonic, empty passphrase.
 */
export function seedFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic.trim());
}

/** Derive a single chain address at the given account index. */
export function deriveChainAddress(seed: Uint8Array, chain: NativeChain, index = 0): string {
  return deriveAddress(seed, chain, index);
}

/**
 * Derive the full set of addresses for a wallet (one per native chain, index 0).
 * USDC and other tokens are surfaced via `tokens` on the base-chain address.
 */
export function deriveAllAddresses(
  seed: Uint8Array,
  chains: readonly NativeChain[] = DEFAULT_CHAINS,
): DerivedAddress[] {
  return chains.map((chain) => ({
    chain,
    address: deriveChainAddress(seed, chain, 0),
    tokens: CHAINS[chain].tokens,
  }));
}
