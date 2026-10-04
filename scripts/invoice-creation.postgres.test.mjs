import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const exec = promisify(execFile);
const container = 'coinpay-invoice-test-' + process.pid;
const owner = '11111111-1111-4111-8111-111111111111';
const business = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const invoice = {
  user_id: owner,
  business_id: business,
  amount: 10,
  currency: 'USD',
  fee_rate: 0.01,
  metadata: {},
};
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
function psqlInput(statement) {
  const { text, values = {} } = typeof statement === 'string' ? { text: statement } : statement;
  return {
    text,
    args: args.concat(
      Object.entries(values).flatMap(([name, value]) => ['-v', name + '=' + value])
    ),
  };
}
const sql = (statement) => {
  const input = psqlInput(statement);
  return execFileSync('docker', input.args, { input: input.text, encoding: 'utf8' }).trim();
};
// psql quotes :'value' as a literal and :"role" as an identifier. Read from stdin:
// -c does not expand psql variables and must not be used for these statements.
const create = (key, hash = 'a'.repeat(64), fields = invoice, schedule = null, limit = null) => ({
  text: `SET ROLE :"role";
    SET application_name TO :'application_name';
    SELECT row_to_json(r) FROM create_idempotent_invoice(
      :'business'::uuid, :'key', :'hash', :'invoice'::jsonb,
      :'schedule'::jsonb, NULLIF(:'rate_limit', '')::integer
    ) r;`,
  values: {
    role: 'postgres',
    application_name: '',
    business: fields.business_id,
    key,
    hash,
    invoice: JSON.stringify(fields),
    schedule: JSON.stringify(schedule),
    rate_limit: limit ?? '',
  },
});
const asyncSql = (statement) => {
  const input = psqlInput(statement);
  const pending = exec('docker', input.args, { encoding: 'utf8' });
  pending.child.stdin.end(input.text);
  return pending.then(({ stdout }) => stdout.trim());
};
const concurrent = (statement) => asyncSql(statement).then((output) => JSON.parse(output));

test(
  'PostgreSQL invoice creation transaction, replay and privileges',
  { timeout: 90000 },
  async () => {
    execFileSync(
      'docker',
      [
        'run',
        '--detach',
        '--rm',
        '--pull=never',
        '--network',
        'none',
        '--name',
        container,
        '-e',
        'POSTGRES_HOST_AUTH_METHOD=trust',
        '--tmpfs',
        '/var/lib/postgresql/data',
        'postgres:17-alpine',
      ],
      { stdio: 'pipe' }
    );
    try {
      for (let n = 0; ; n++) {
        try {
          execFileSync(
            'docker',
            ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
            { stdio: 'pipe' }
          );
          break;
        } catch {
          if (n === 40) throw new Error('Postgres did not start');
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      sql({
        text: `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
          CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
          CREATE TABLE merchants(id uuid PRIMARY KEY); CREATE TABLE businesses(id uuid PRIMARY KEY);
          INSERT INTO merchants VALUES (:'owner');
          INSERT INTO businesses VALUES (:'business'),(:'other');`,
        values: { owner, business, other },
      });
      sql(
        readFileSync(
          new URL(
            '../supabase/migrations/20260304180000_create_invoicing_system.sql',
            import.meta.url
          ),
          'utf8'
        )
      );
      sql(
        readFileSync(
          new URL(
            '../supabase/migrations/20260907100000_invoice_creation_idempotency.sql',
            import.meta.url
          ),
          'utf8'
        )
      );
      const results = await Promise.all(
        Array.from({ length: 12 }, () => concurrent(create('race')))
      );
      assert.equal(new Set(results.map((r) => r.invoice_id)).size, 1);
      assert.equal(results.filter((r) => !r.replayed).length, 1);
      assert.equal(sql('SELECT count(*) FROM invoices'), '1');
      assert.equal(sql('SELECT count(*) FROM invoice_creation_requests'), '1');

      assert.throws(
        () => sql(create('race', 'b'.repeat(64), { ...invoice, amount: 11 })),
        /different terms/
      );
      sql({
        text: "UPDATE invoices SET status='cancelled' WHERE id=:'id';",
        values: { id: results[0].invoice_id },
      });
      assert.equal(JSON.parse(sql(create('race'))).invoice_id, results[0].invoice_id);
      assert.equal(
        sql({
          text: "SELECT status FROM invoices WHERE id=:'id'",
          values: { id: results[0].invoice_id },
        }),
        'cancelled'
      );

      const scoped = JSON.parse(
        sql(create('race', 'a'.repeat(64), { ...invoice, business_id: other }))
      );
      assert.notEqual(scoped.invoice_id, results[0].invoice_id);
      const scheduled = JSON.parse(
        sql(create('schedule', 'a'.repeat(64), invoice, { recurrence: 'weekly' }))
      );
      sql(create('schedule', 'a'.repeat(64), invoice, { recurrence: 'weekly' }));
      assert.equal(
        sql({
          text: "SELECT count(*) FROM invoice_schedules WHERE invoice_id=:'id'",
          values: { id: scheduled.invoice_id },
        }),
        '1'
      );

      assert.throws(
        () => sql(create('bad-schedule', 'a'.repeat(64), invoice, { recurrence: 'bad' })),
        /check constraint/
      );
      assert.equal(
        sql("SELECT count(*) FROM invoice_creation_requests WHERE idempotency_key='bad-schedule'"),
        '0'
      );
      assert.equal(sql('SELECT count(*) FROM invoices'), '3');
      const recovered = JSON.parse(sql(create('bad-schedule')));
      assert.equal(recovered.replayed, false);

      const deleted = JSON.parse(sql(create('deleted')));
      sql({ text: "DELETE FROM invoices WHERE id=:'id'", values: { id: deleted.invoice_id } });
      assert.throws(() => sql(create('deleted')), /Original invoice was deleted/);
      assert.equal(
        sql(
          "SELECT count(*) FROM invoice_creation_requests WHERE idempotency_key='deleted' AND invoice_id IS NULL"
        ),
        '1'
      );

      const different = await Promise.all(
        Array.from({ length: 8 }, (_, i) => concurrent(create('distinct-' + i)))
      );
      assert.equal(new Set(different.map((r) => r.invoice_id)).size, 8);
      // Later production migrations add this second uniqueness constraint.
      // Restore order can make either one report an invoice-number collision.
      sql(`DROP INDEX idx_invoices_business_invoice_number;
        ALTER TABLE invoices ADD CONSTRAINT invoices_business_id_invoice_number_key
          UNIQUE (business_id, invoice_number);`);
      // A legacy insert acquires an FK KEY SHARE on the business. Keyed
      // creation must not deadlock it while retrying an invoice-number clash.
      sql(`CREATE FUNCTION pause_keyed_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.notes = 'mixed-keyed-race' THEN PERFORM pg_sleep(0.8); END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER pause_keyed BEFORE INSERT ON invoices
        FOR EACH ROW EXECUTE FUNCTION pause_keyed_insert();`);
      const pausedRequest = create('mixed-keyed', 'a'.repeat(64), {
        ...invoice,
        notes: 'mixed-keyed-race',
      });
      pausedRequest.values.application_name = 'keyed-creation-test';
      const keyedWithPause = asyncSql(pausedRequest);
      for (let attempt = 0; ; attempt++) {
        if (
          sql(
            "SELECT count(*) FROM pg_stat_activity WHERE application_name='keyed-creation-test' AND wait_event='PgSleep'"
          ) === '1'
        )
          break;
        if (attempt >= 40) throw new Error('Keyed transaction did not acquire business lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const legacyInsert = asyncSql({
        text: `INSERT INTO invoices(user_id,business_id,invoice_number,status,currency,amount)
         SELECT :'owner', :'business',
           'INV-' || lpad((coalesce(max(substring(invoice_number FROM '^INV-([0-9]+)$')::integer),0)+1)::text,3,'0'),
           'draft','USD',10 FROM invoices WHERE business_id=:'business';`,
        values: { owner, business },
      });
      await Promise.all([keyedWithPause, legacyInsert]);
      sql('DROP TRIGGER pause_keyed ON invoices; DROP FUNCTION pause_keyed_insert();');
      sql(
        'CREATE UNIQUE INDEX idx_invoices_business_invoice_number ON invoices(business_id,invoice_number);'
      );
      assert.equal(
        sql({
          text: "SELECT count(*) - count(DISTINCT invoice_number) FROM invoices WHERE business_id=:'business'",
          values: { business },
        }),
        '0'
      );
      const sourceInvoice = {
        ...invoice,
        metadata: { source_reference: { repository: 'Example/Repo' } },
      };
      const capped = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          concurrent(create('limited-' + i, 'a'.repeat(64), sourceInvoice, null, 2))
        )
      );
      assert.equal(capped.filter((r) => r.status === 'fulfilled').length, 2);
      for (const result of capped.filter((r) => r.status === 'rejected')) {
        assert.match(result.reason.stderr, /Repository invoice rate limit reached/);
      }
      const acceptedIndex = capped.findIndex((r) => r.status === 'fulfilled');
      const replayed = JSON.parse(
        sql(create('limited-' + acceptedIndex, 'a'.repeat(64), sourceInvoice, null, 2))
      );
      assert.equal(replayed.replayed, true);
      sql({ text: "DELETE FROM invoices WHERE id=:'id'", values: { id: replayed.invoice_id } });
      assert.throws(
        () => sql(create('limited-new', 'a'.repeat(64), sourceInvoice, null, 2)),
        /rate limit reached/
      );
      const lowerCaseSource = {
        ...invoice,
        metadata: { source_reference: { repository: 'example/repo' } },
      };
      assert.throws(
        () => sql(create('limited-case', 'a'.repeat(64), lowerCaseSource, null, 2)),
        /rate limit reached/
      );
      sql(
        "UPDATE invoice_creation_requests SET created_at=now()-interval '61 minutes' WHERE source_repository='example/repo'"
      );
      assert.equal(
        JSON.parse(sql(create('limited-after-window', 'a'.repeat(64), sourceInvoice, null, 2)))
          .replayed,
        false
      );
      for (const role of ['anon', 'authenticated']) {
        assert.equal(
          sql({
            text: "SELECT has_function_privilege(:'role', 'create_idempotent_invoice(uuid,text,text,jsonb,jsonb,integer)', 'execute')",
            values: { role },
          }),
          'f'
        );
        assert.equal(
          sql({
            text: "SELECT has_table_privilege(:'role', 'invoice_creation_requests', 'select')",
            values: { role },
          }),
          'f'
        );
      }
      assert.equal(
        sql(
          "SELECT has_function_privilege('service_role', 'create_idempotent_invoice(uuid,text,text,jsonb,jsonb,integer)', 'execute')"
        ),
        't'
      );
      // Mirrors Supabase's existing grants. The function itself cannot bypass RLS.
      sql('GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;');
      const serviceRequest = create('service-role');
      serviceRequest.values.role = 'service_role';
      sql(serviceRequest);
      const quotedNotes = "Author's fee; DROP TABLE invoices; -- \\ fixture";
      assert.throws(() => sql(create("quote'; --")), /Invalid invoice creation identity/);
      const quoted = JSON.parse(
        sql(
          create('quoted-notes', 'a'.repeat(64), {
            ...invoice,
            notes: quotedNotes,
          })
        )
      );
      assert.equal(
        sql({
          text: "SELECT notes FROM invoices WHERE id=:'id'",
          values: { id: quoted.invoice_id },
        }),
        quotedNotes
      );
      assert.equal(
        JSON.parse(
          sql(
            create('quoted-notes', 'a'.repeat(64), {
              ...invoice,
              notes: quotedNotes,
            })
          )
        ).invoice_id,
        quoted.invoice_id
      );
      console.log(
        '12 concurrent retries: one invoice; scoped keys, schedules, rollback, tombstones, numbering and role gates passed.'
      );
    } finally {
      execFileSync('docker', ['stop', container], { stdio: 'pipe' });
    }
  }
);
