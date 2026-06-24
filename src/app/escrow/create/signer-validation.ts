/**
 * Client-side signer validation for 2-of-3 multisig escrow.
 *
 * Pure, dependency-free format checks so the create form can give
 * field-level feedback *before* hitting the authenticated API. This
 * mirrors (loosely) the server-side checks in the multisig adapters:
 *  - EVM chains expect a `0x` + 40-hex signer address.
 *  - UTXO chains expect a hex public key (33-byte compressed or 65-byte
 *    uncompressed).
 *  - Solana expects a base58 public key.
 *
 * It intentionally does not pull in ethers/bitcoinjs (heavy, server
 * oriented). The server remains the source of truth; this only catches
 * obvious mistakes early.
 */

export type MultisigSignerRole = 'Depositor' | 'Beneficiary' | 'Arbiter';

const EVM_MULTISIG_CHAINS = ['ETH', 'POL', 'BASE', 'ARB', 'OP', 'BNB', 'AVAX'];
const UTXO_MULTISIG_CHAINS = ['BTC', 'LTC', 'DOGE'];

export function isEvmMultisigChain(chain: string): boolean {
  return EVM_MULTISIG_CHAINS.includes(chain);
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_COMPRESSED_PUBKEY_RE = /^(02|03)[0-9a-fA-F]{64}$/;
const HEX_UNCOMPRESSED_PUBKEY_RE = /^04[0-9a-fA-F]{128}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Validate a single multisig signer value for the given chain.
 * Returns a human-readable error string, or `null` when the value is valid.
 */
export function validateMultisigSigner(value: string, chain: string): string | null {
  const v = value.trim();
  if (!v) {
    return 'Required';
  }

  if (isEvmMultisigChain(chain)) {
    return EVM_ADDRESS_RE.test(v)
      ? null
      : 'Enter a valid signer address (0x followed by 40 hex characters).';
  }

  if (UTXO_MULTISIG_CHAINS.includes(chain)) {
    return HEX_COMPRESSED_PUBKEY_RE.test(v) || HEX_UNCOMPRESSED_PUBKEY_RE.test(v)
      ? null
      : 'Enter a valid public key in hex (66 chars starting 02/03, or 130 chars starting 04).';
  }

  if (chain === 'SOL') {
    return BASE58_RE.test(v)
      ? null
      : 'Enter a valid Solana public key (32–44 base58 characters).';
  }

  // Unknown chain — fall back to a permissive length check.
  return v.length >= 20 ? null : 'Public key looks too short.';
}
