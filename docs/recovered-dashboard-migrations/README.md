# Recovered dashboard migrations

These four migrations were applied directly to the production database through
the Supabase dashboard SQL editor and never committed. That left the CLI's
migration history out of sync with the repo, which blocked `supabase db push`
and `supabase db pull` entirely.

They were recovered from `supabase_migrations.schema_migrations` (Supabase
records each applied migration's statements) and are kept here **for reference
only**.

## Do not move these into `supabase/migrations/`

Each one is a comment-stripped copy of a migration that already exists in the
repo under a different version:

| Recovered version | Same SQL as |
|---|---|
| `20260708002700` | `20260707210000_scoped_api_keys.sql` |
| `20260713091221` | `20260713130000_cli_device_auth.sql` |
| `20260722014011` | `20260722000000_rls_business_api_keys.sql` |
| `20260722014014` | `20260722010000_revoke_exec_create_default_org_trigger_fn.sql` |

The history was reconciled by marking the four dashboard versions `reverted` and
the four repo versions `applied` — accurate, because the repo files' SQL is what
is actually live. Re-adding these as migrations would apply the same statements
a second time.

## The lesson

Run migrations with `supabase db push`, not by pasting into the dashboard. The
dashboard assigns its own timestamps, so the repo and the database disagree about
history and the CLI refuses to operate until someone untangles it.
