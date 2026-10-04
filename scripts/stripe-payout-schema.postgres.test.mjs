import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

test('payout migration repairs the production schema without losing payout data', { timeout: 30000 }, async () => {
  const container = `coinpay-payout-schema-${process.pid}`;
  const sql = (text) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: text, encoding: 'utf8' }).trim();
  execFileSync('docker', ['run', '--detach', '--rm', '--pull=never', '--network', 'none', '--name', container,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '--tmpfs', '/var/lib/postgresql/data', 'postgres:17-alpine'], { stdio: 'pipe' });
  try {
    for (let n = 0; ; n++) {
      try {
        execFileSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { stdio: 'pipe' });
        break;
      } catch {
        if (n === 40) throw new Error('Postgres did not start');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    // Exact column names/types from the production table before this repair.
    sql(`CREATE TABLE public.stripe_payouts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid,
      stripe_payout_id text UNIQUE, amount bigint, currency text, status text,
      arrival_date timestamp, created_at timestamp DEFAULT now()
    );
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    INSERT INTO public.stripe_payouts (stripe_payout_id, amount, currency, status, created_at)
    VALUES ('po_existing', 1234, 'usd', 'pending', '2026-01-01T12:00:00');`);
    assert.throws(() => sql('SELECT updated_at FROM public.stripe_payouts;'), /updated_at.*does not exist/);
    const migration = readFileSync(new URL('../supabase/migrations/20260913190000_restore_stripe_payout_fields.sql', import.meta.url), 'utf8');
    sql(migration);
    const old = JSON.parse(sql("SELECT row_to_json(p) FROM public.stripe_payouts p WHERE stripe_payout_id = 'po_existing';"));
    assert.equal(old.amount, 1234);
    assert.equal(old.status, 'pending');
    assert.equal(old.description, null);
    assert.equal(new Date(old.updated_at).toISOString(), '2026-01-01T12:00:00.000Z');
    // The GET projection, POST insert and paid webhook update must all work.
    sql('SELECT id, stripe_payout_id, amount, currency, status, arrival_date, created_at, updated_at FROM public.stripe_payouts;');
    sql("INSERT INTO public.stripe_payouts (stripe_payout_id, amount, description) VALUES ('po_new', 200, 'New payout');");
    assert.equal(sql("SELECT updated_at IS NOT NULL FROM public.stripe_payouts WHERE stripe_payout_id = 'po_new';"), 't');
    sql("UPDATE public.stripe_payouts SET status = 'paid' WHERE stripe_payout_id = 'po_existing';");
    assert.equal(sql("SELECT updated_at > '2026-01-01T12:00:00Z' FROM public.stripe_payouts WHERE stripe_payout_id = 'po_existing';"), 't');
    const updated = sql("SELECT updated_at FROM public.stripe_payouts WHERE stripe_payout_id = 'po_existing';");
    sql(migration);
    assert.equal(sql("SELECT updated_at FROM public.stripe_payouts WHERE stripe_payout_id = 'po_existing';"), updated);
    assert.equal(sql('SELECT count(*) FROM public.stripe_payouts;'), '2');
  } finally {
    execFileSync('docker', ['rm', '--force', container], { stdio: 'pipe' });
  }
});
