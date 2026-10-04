-- AUD-01 (2026-08-19 audit): no audit-logging infrastructure exists anywhere.
--
-- Confirmed by reading: no audit table, no append-only log, no key-access
-- record. Meanwhile `docs/SECURITY_KEYS.md` carried `[x] Audit logging for key
-- operations` and `docs/SECURITY.md` described a four-point audit trail in the
-- present tense. Those documents were corrected earlier in this branch; this is
-- the other half — the thing they described.
--
-- Design notes:
--
--  * Append-only by grant, not by convention. `service_role` may INSERT and
--    SELECT and is granted neither UPDATE nor DELETE, so an event cannot be
--    rewritten by the same credential that wrote it. That is the property that
--    makes a log worth reading after an incident.
--
--  * No foreign keys to the subjects. An audit record must survive the deletion
--    of whatever it describes — a log that cascades away with the row it was
--    recording is not an audit log. `subject_type` + `subject_id` are plain
--    columns for that reason.
--
--  * `actor_*` records WHO, `subject_*` records WHAT, `action` records what
--    happened. All three are needed: "payment 123 changed" without an actor is
--    an event log, not an audit trail.

create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),

  -- What happened. Dotted namespace, e.g. 'payment.confirmed',
  -- 'wallet.payout_changed', 'key.released', 'did.rebound'.
  action       text not null,

  -- Who did it. `actor_type` distinguishes a merchant session from an API key,
  -- a platform issuer, or the system itself (cron, monitor).
  actor_type   text not null check (actor_type in ('merchant', 'api_key', 'platform', 'system', 'anonymous')),
  actor_id     text,

  -- What it was done to. Deliberately not FK-constrained; see above.
  subject_type text not null,
  subject_id   text,

  -- Tenant scoping, so a merchant can be shown their own trail.
  business_id  uuid,
  merchant_id  uuid,

  -- Anything else worth keeping. Must never contain key material or secrets.
  detail       jsonb not null default '{}'::jsonb,

  ip           text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);
create index if not exists idx_audit_log_subject on public.audit_log(subject_type, subject_id);
create index if not exists idx_audit_log_actor on public.audit_log(actor_type, actor_id);
create index if not exists idx_audit_log_merchant on public.audit_log(merchant_id) where merchant_id is not null;
create index if not exists idx_audit_log_action on public.audit_log(action);

alter table public.audit_log enable row level security;

-- Nobody reaches this table through the browser roles. Reads go through an
-- admin-guarded route, the same pattern as the other admin surfaces here.
revoke all on table public.audit_log from public, anon, authenticated;

-- Append-only: insert and read, never update or delete.
grant insert, select on table public.audit_log to service_role;

comment on table public.audit_log is
  'Append-only audit trail (AUD-01). service_role holds INSERT and SELECT only — no UPDATE or DELETE grant — so an event cannot be rewritten by the credential that wrote it. Never store key material or secrets in `detail`.';
