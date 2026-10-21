/**
 * Who paid, and where: the optional `metadata` a seller sends with an x402
 * settle call.
 *
 * Without it a ledger row says only which wallet paid which business, and
 * `resource` is the offer's URL (always the seller's sales page), so neither
 * the page that was actually bought nor the property inside a multi-site
 * business can be told apart. The seller knows both, so it says so.
 *
 * The caller is the seller, holding a scoped key on its own business, so this
 * is the seller's own annotation rather than anything trusted for money. It is
 * still bounded: a fixed set of keys, short strings, nothing nested, so a
 * buggy or hostile integrator cannot turn the ledger into a blob store. Raw
 * IPs are not accepted at all; the seller sends a hash.
 */

const FIELDS: Record<string, number> = {
  property: 253,
  resource_path: 1024,
  payer: 128,
  user_agent: 512,
  ip_hash: 128,
  account_id: 256,
  source: 64,
};

/** Keep the known fields, as trimmed, capped strings. Null when nothing is left. */
export function sanitizeX402Metadata(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const [key, max] of Object.entries(FIELDS)) {
    const raw = (input as Record<string, unknown>)[key];
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const value = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}
