import type { UnsignedTransactionData } from '../web-wallet/prepare-tx';

/**
 * Check that a server-prepared transaction pays who the caller asked it to.
 *
 * REC-04: `WalletSDK.send()` asked the server to prepare a transaction and then
 * signed whatever came back. The wallet holds the key, so the server never
 * needs to see it — but that only helps if the thing being signed is checked.
 * A compromised or hostile server could return an `unsigned_tx` paying its own
 * address while echoing the requested recipient back in the JSON alongside it,
 * and the SDK would sign it without looking.
 *
 * The unsigned transaction is a structured object rather than an opaque blob,
 * so this needs no chain-specific decoding: the recipient is right there in
 * every variant.
 *
 * Recipient only, deliberately. It is the field that turns a payment into a
 * theft, and it can be compared exactly on all three chain families. Amounts
 * live in different units per variant (hex wei, satoshis, lamports) and the
 * conversion from the caller's human-readable figure is where a bug would
 * silently weaken the check; the broadcast endpoint verifies the amount
 * server-side against the prepared row instead.
 */
export function preparedTxPaysRecipient(
  unsignedTx: UnsignedTransactionData,
  expectedTo: string,
): boolean {
  if (!expectedTo) return false;
  const want = expectedTo.trim().toLowerCase();

  switch (unsignedTx.type) {
    case 'evm': {
      // For an ERC-20 transfer the tx `to` is the token contract and the real
      // recipient sits in the calldata, left-padded to 32 bytes after the
      // 4-byte selector.
      if (unsignedTx.data && unsignedTx.data !== '0x' && unsignedTx.data.length >= 138) {
        const recipient = `0x${unsignedTx.data.slice(34, 74)}`.toLowerCase();
        return recipient === want;
      }
      return (unsignedTx.to ?? '').toLowerCase() === want;
    }

    case 'btc':
    case 'bch': {
      // A real spend has a change output back to the sender, so this asks
      // whether the payee is paid at all — not whether they are the only one.
      // Bitcoin addresses are case-sensitive, so compare both ways.
      return (unsignedTx.outputs ?? []).some(
        (o) => o.address === expectedTo.trim() || o.address?.toLowerCase() === want,
      );
    }

    case 'sol': {
      const instructions = unsignedTx.instructions ?? [];
      return instructions.some((ix) => {
        const raw = ix as unknown as Record<string, unknown>;
        const candidates = [raw.destination, raw.to, raw.recipient]
          .filter((v): v is string => typeof v === 'string');
        if (candidates.some((c) => c === expectedTo.trim() || c.toLowerCase() === want)) {
          return true;
        }
        const keys = raw.keys;
        if (Array.isArray(keys)) {
          return keys.some((k) => {
            const pk = (k as { pubkey?: unknown })?.pubkey;
            return typeof pk === 'string' && (pk === expectedTo.trim() || pk.toLowerCase() === want);
          });
        }
        return false;
      });
    }

    default:
      // An unrecognised shape cannot be checked, and "cannot check" must not
      // read as "checked and fine".
      return false;
  }
}
