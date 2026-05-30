/**
 * Lightweight, dependency-free payout-address format checks.
 *
 * This deliberately avoids importing the full wallet/keygen stack
 * (ethers / @solana/web3.js / bitcoinjs-lib) so it can be used inside hot API
 * routes and unit-tested without pulling heavy crypto libraries. It validates
 * address *shape* per chain — enough to reject an address pasted for the wrong
 * network before it gets used as a forwarding destination.
 */

/**
 * Map a payment blockchain (which may be a token variant like USDC_SOL) to the
 * base chain whose address format we validate against. Bare stablecoin tickers
 * carry no chain, so default them to the rail clients use (USDT = EVM/ETH,
 * USDC = Solana).
 */
function baseChainFor(blockchain: string): string {
  const base = blockchain.replace(/^USD[CT]_/, '');
  if (base === 'USDT') return 'ETH';
  if (base === 'USDC') return 'SOL';
  return base;
}

/**
 * Validate a payout address for a given blockchain.
 *
 * @returns `true` if the address is well-formed for the chain, `false` if it is
 *   malformed, and `null` when we have no validator for the chain (caller should
 *   skip validation and trust the address rather than reject a legitimate one).
 */
export function isValidPayoutAddress(address: string, blockchain: string): boolean | null {
  if (!address) return false;
  const chain = baseChainFor(blockchain);
  switch (chain) {
    case 'ETH':
    case 'POL':
      return /^0x[0-9a-fA-F]{40}$/.test(address);
    case 'SOL':
      return address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
    case 'BTC':
      return /^(bc1[a-z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address);
    case 'BCH':
      return (
        /^(bitcoincash:)?[qp][a-z0-9]{41,90}$/.test(address) ||
        /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)
      );
    default:
      return null; // DOGE/XRP/ADA/BNB — no format validator; trust the caller.
  }
}
