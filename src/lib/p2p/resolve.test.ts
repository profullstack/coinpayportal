import { describe, expect, it } from 'vitest';
import { resolveOrProvisionPayee } from './resolve';

/**
 * Regression tests for NEW-04 (Critical, 2026-08-19 audit).
 *
 * `resolveOrProvisionPayee` matched `merchants` by email with no scoping, and
 * `persistPayout` then upserted `merchant_wallets` on
 * `(merchant_id, cryptocurrency)`. Naming a victim's email therefore overwrote
 * that merchant's payout address with the caller's, diverting every future
 * payment on that chain. Reachable by any holder of a `reputation_issuers` key.
 */

type MerchantRow = { id: string; email: string; auth_provider: string };
type DidRow = { did: string; merchant_id: string };
type BusinessRow = { id: string; merchant_id: string; platform: string; external_user_did: string };

type Fixture = {
  merchants?: MerchantRow[];
  dids?: DidRow[];
  businesses?: BusinessRow[];
};

/**
 * Supabase double covering just the query shapes `resolveOrProvisionPayee`
 * uses. Records every wallet write so a test can assert one did not happen.
 */
function makeSupabase(fixture: Fixture) {
  const merchants = [...(fixture.merchants ?? [])];
  const dids = [...(fixture.dids ?? [])];
  const businesses = [...(fixture.businesses ?? [])];
  const walletWrites: Array<Record<string, unknown>> = [];
  const stripeWrites: Array<Record<string, unknown>> = [];

  let created = 0;

  function builder(table: string) {
    const filters: Record<string, unknown> = {};

    const chain: Record<string, unknown> = {
      select() {
        return chain;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
      async maybeSingle() {
        if (table === 'businesses') {
          const hit = businesses.find(
            (b) => b.platform === filters.platform && b.external_user_did === filters.external_user_did
          );
          return { data: hit ?? null, error: null };
        }
        if (table === 'merchant_dids') {
          const hit = dids.find((d) => d.did === filters.did);
          return { data: hit ?? null, error: null };
        }
        if (table === 'merchants') {
          const hit = merchants.find(
            (m) =>
              (filters.email === undefined || m.email === filters.email) &&
              (filters.id === undefined || m.id === filters.id)
          );
          return { data: hit ?? null, error: null };
        }
        throw new Error(`unexpected maybeSingle on ${table}`);
      },
      async single() {
        if (table === 'merchants') {
          const row = { id: `provisioned-${++created}` };
          merchants.push({
            id: row.id,
            email: String(filters.__insertEmail ?? ''),
            auth_provider: 'platform',
          });
          return { data: row, error: null };
        }
        if (table === 'businesses') {
          const row = { id: `biz-${++created}`, merchant_id: String(filters.__insertMerchant ?? '') };
          return { data: row, error: null };
        }
        throw new Error(`unexpected single on ${table}`);
      },
      insert(values: Record<string, unknown>) {
        if (table === 'merchants') filters.__insertEmail = values.email;
        if (table === 'businesses') filters.__insertMerchant = values.merchant_id;
        if (table === 'merchant_dids') {
          dids.push({ did: String(values.did), merchant_id: String(values.merchant_id) });
          return Promise.resolve({ error: null });
        }
        return chain;
      },
      update() {
        return chain;
      },
      upsert(values: Record<string, unknown>) {
        if (table === 'merchant_wallets') walletWrites.push(values);
        if (table === 'stripe_accounts') stripeWrites.push(values);
        return Promise.resolve({ error: null });
      },
    };

    return chain;
  }

  return {
    client: { from: (table: string) => builder(table) } as never,
    walletWrites,
    stripeWrites,
    merchants,
  };
}

const VICTIM_EMAIL = 'merchant@example.com';
const ATTACKER_ADDRESS = 'bc1qattackercontrolledaddress';

const CRYPTO_PAYOUT = {
  kind: 'crypto' as const,
  cryptocurrency: 'BTC',
  address: ATTACKER_ADDRESS,
};

describe('resolveOrProvisionPayee', () => {
  it('refuses to resolve a self-registered CoinPay merchant by email', async () => {
    const { client, walletWrites } = makeSupabase({
      merchants: [{ id: 'victim-1', email: VICTIM_EMAIL, auth_provider: 'self' }],
    });

    const result = await resolveOrProvisionPayee(
      client,
      'attacker-platform',
      { did: 'did:key:zAttacker', email: VICTIM_EMAIL },
      CRYPTO_PAYOUT
    );

    expect(result.success).toBe(false);
    expect(walletWrites).toHaveLength(0);
  });

  it('never writes a payout wallet for a non-platform merchant', async () => {
    // Belt and braces: even reached via a DID row pointing at a real account,
    // the payout write must not land.
    const { client, walletWrites, stripeWrites } = makeSupabase({
      merchants: [{ id: 'victim-1', email: VICTIM_EMAIL, auth_provider: 'self' }],
      dids: [{ did: 'did:key:zPlanted', merchant_id: 'victim-1' }],
    });

    await resolveOrProvisionPayee(
      client,
      'attacker-platform',
      { did: 'did:key:zPlanted', email: VICTIM_EMAIL },
      CRYPTO_PAYOUT
    );

    expect(walletWrites).toHaveLength(0);
    expect(stripeWrites).toHaveLength(0);
  });

  it('provisions a new merchant and records its payout when the email is unknown', async () => {
    const { client, walletWrites } = makeSupabase({});

    const result = await resolveOrProvisionPayee(
      client,
      'ugig',
      { did: 'did:key:zNewUser', email: 'newuser@example.com', name: 'New User' },
      CRYPTO_PAYOUT
    );

    expect(result.success).toBe(true);
    expect(walletWrites).toHaveLength(1);
    expect(walletWrites[0].wallet_address).toBe(ATTACKER_ADDRESS);
    expect(walletWrites[0].cryptocurrency).toBe('BTC');
  });

  it('updates the payout for an account the platform itself provisioned', async () => {
    const { client, walletWrites } = makeSupabase({
      merchants: [{ id: 'plat-1', email: 'platuser@example.com', auth_provider: 'platform' }],
      dids: [{ did: 'did:key:zPlatUser', merchant_id: 'plat-1' }],
    });

    const result = await resolveOrProvisionPayee(
      client,
      'ugig',
      { did: 'did:key:zPlatUser', email: 'platuser@example.com' },
      { kind: 'crypto', cryptocurrency: 'BTC', address: 'bc1qtheirnewaddress' }
    );

    expect(result.success).toBe(true);
    expect(walletWrites).toHaveLength(1);
    expect(walletWrites[0].merchant_id).toBe('plat-1');
  });

  it('ignores an unsupported cryptocurrency rather than writing it', async () => {
    const { client, walletWrites } = makeSupabase({});

    await resolveOrProvisionPayee(
      client,
      'ugig',
      { did: 'did:key:zNewUser2', email: 'newuser2@example.com' },
      { kind: 'crypto', cryptocurrency: 'NOTACOIN', address: 'whatever' }
    );

    expect(walletWrites).toHaveLength(0);
  });
});
