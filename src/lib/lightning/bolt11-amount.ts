/**
 * Read the amount out of a BOLT-11 invoice, without a decoder dependency.
 *
 * W-06's sibling, W-05: when paying a Lightning Address, the flow asks the
 * recipient's LNURL server for an invoice and then pays whatever comes back.
 * Nothing decoded it, so the amount actually paid was whatever the *recipient's
 * server* chose to put in the invoice — not the amount the sender asked for and
 * was shown. A hostile or compromised LNURL endpoint could return an invoice
 * for any amount up to the wallet's balance and it would be paid silently.
 *
 * The amount lives in the human-readable part of the invoice and needs no bech32
 * decoding to read: the HRP is `ln` + currency prefix + an optional amount, and
 * the amount is digits followed by an optional multiplier. That is a well-defined
 * grammar in BOLT-11 §Human-Readable Part, and parsing only it avoids pulling in
 * a full invoice decoder to answer one question.
 *
 * Returns the amount in millisatoshi, or `null` for an amountless invoice (a
 * "donation" invoice, where the payer chooses) or anything unparseable. `null`
 * means "cannot tell" and callers must treat it as a refusal, never as
 * agreement.
 */

/** BTC-per-unit for each BOLT-11 multiplier, expressed as msat per unit. */
const MULTIPLIER_MSAT: Record<string, number> = {
  // 1 BTC = 1e8 sat = 1e11 msat
  m: 1e8, // milli  = 1e-3 BTC
  u: 1e5, // micro  = 1e-6 BTC
  n: 1e2, // nano   = 1e-9 BTC
  p: 1e-1, // pico  = 1e-12 BTC
};

/** Currency prefixes we accept. Mainnet only — testnet invoices are a config error here. */
const MAINNET_PREFIX = 'lnbc';

export function bolt11AmountMsat(invoice: string): number | null {
  if (typeof invoice !== 'string') return null;

  const lower = invoice.trim().toLowerCase();
  if (!lower.startsWith(MAINNET_PREFIX)) return null;

  // The HRP ends at the LAST '1' (the bech32 separator), because the data part
  // is bech32 and never contains '1'.
  const separator = lower.lastIndexOf('1');
  if (separator <= MAINNET_PREFIX.length - 1) return null;

  const amountPart = lower.slice(MAINNET_PREFIX.length, separator);
  if (amountPart === '') return null; // amountless invoice — payer chooses

  const match = amountPart.match(/^(\d+)([munp]?)$/);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const multiplier = match[2];
  if (!multiplier) {
    // No multiplier means whole BTC.
    return value * 1e11;
  }

  const msatPerUnit = MULTIPLIER_MSAT[multiplier];
  if (msatPerUnit === undefined) return null;

  const msat = value * msatPerUnit;
  // A pico-denominated amount that is not a whole msat is invalid per BOLT-11.
  if (!Number.isInteger(msat)) return null;

  return msat;
}
