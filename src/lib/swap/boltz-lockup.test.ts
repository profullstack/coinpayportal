import { describe, expect, it } from 'vitest';
import { lockupAddressMatchesScript } from './boltz';

/**
 * Regression tests for W-06 (High, 2026-08-19 audit).
 *
 * `redeemScript` and `swapTree` were declared on the Boltz response types and
 * never read. The lockup address was taken on faith, so a substituted address
 * would have been funded happily — and the refund key generated locally is
 * worthless against it, because that key belongs to a different script. The
 * deposit would be unrecoverable, which is exactly what a refund key exists to
 * prevent.
 */
describe('lockupAddressMatchesScript', () => {
  // A real redeem script shape: OP_HASH160 <20 bytes> OP_EQUAL-ish filler. The
  // content does not matter — what matters is that hashing it must reproduce
  // the address, and that a different address must not match.
  const REDEEM_SCRIPT =
    'a91412ab8dc588ca9d5787dde7eb29569da63c3a238c87';

  async function p2wshAddressFor(scriptHex: string) {
    const bitcoin = await import('bitcoinjs-lib');
    return bitcoin.payments.p2wsh({
      redeem: { output: Buffer.from(scriptHex, 'hex'), network: bitcoin.networks.bitcoin },
      network: bitcoin.networks.bitcoin,
    }).address!;
  }

  it('accepts the address the script actually hashes to', async () => {
    const address = await p2wshAddressFor(REDEEM_SCRIPT);
    await expect(lockupAddressMatchesScript(address, REDEEM_SCRIPT)).resolves.toBe(true);
  });

  it('rejects a substituted address', async () => {
    // The attack this exists to stop: a valid-looking address that has nothing
    // to do with the script we hold a refund key for.
    const attacker = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    await expect(lockupAddressMatchesScript(attacker, REDEEM_SCRIPT)).resolves.toBe(false);
  });

  it('rejects an address derived from a different script', async () => {
    const otherScript = 'a914000000000000000000000000000000000000000087';
    const otherAddress = await p2wshAddressFor(otherScript);
    await expect(lockupAddressMatchesScript(otherAddress, REDEEM_SCRIPT)).resolves.toBe(false);
  });

  it('reports "cannot check" rather than passing when no script is returned', async () => {
    // Taproot swaps carry a swapTree instead. Returning null keeps the caller
    // from mistaking "not checkable" for "checked and fine".
    const address = await p2wshAddressFor(REDEEM_SCRIPT);
    await expect(lockupAddressMatchesScript(address, undefined)).resolves.toBeNull();
  });

  it('rejects an unparseable script rather than treating it as absent', async () => {
    const address = await p2wshAddressFor(REDEEM_SCRIPT);
    await expect(lockupAddressMatchesScript(address, '')).resolves.toBeNull();
    await expect(lockupAddressMatchesScript(address, 'zzzz')).resolves.toBe(false);
  });
});
