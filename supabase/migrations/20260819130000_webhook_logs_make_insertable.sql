-- V-01, L8-01, REC-D-02 (2026-08-19 audit): webhook_logs could never be written.
--
-- Confirmed against production: the table holds **zero rows**. The webhook
-- delivery audit trail has never recorded a single attempt, and nothing
-- surfaced that, because delivery itself is unaffected by the logging failing.
--
-- Three separate causes, all of which had to be fixed for an insert to succeed:
--
--  1. V-01 — `url` and `payload` are NOT NULL with no default, and the
--     application writes `webhook_url` instead. Every insert failed on a
--     not-null violation. The two column sets are duplicates of each other from
--     different eras of the schema; the newer names are what the code uses.
--
--  2. L8-01 — `payment_id` had its NOT NULL dropped so escrow events could be
--     logged, but the FK to payments(id) was never dropped alongside it.
--
--  3. REC-D-02 — the escrow path passes an escrow id as `payment_id`
--     ("reuse payment_id column for escrow_id"), which violates that FK. So
--     100% of escrow webhook audit records were lost even once (1) was fixed.
--
-- (1) is fixed by relaxing the legacy columns rather than dropping them: they
-- are still selected by `getWebhookLogs`, and a table with no rows has nothing
-- to migrate. (3) is fixed by giving escrow its own column instead of borrowing
-- one, which keeps the payments FK meaningful for real payments.

-- (1) The legacy pair no longer blocks an insert.
alter table public.webhook_logs alter column url drop not null;
alter table public.webhook_logs alter column payload drop not null;

-- (3) Escrow events get their own reference, so payment_id stays a payment.
alter table public.webhook_logs
  add column if not exists escrow_id uuid references public.escrows(id) on delete cascade;

create index if not exists idx_webhook_logs_escrow_id
  on public.webhook_logs(escrow_id) where escrow_id is not null;

-- Exactly one subject per row: a webhook is about a payment or an escrow, never
-- both. Written as a CHECK so a future caller cannot quietly reintroduce the
-- column-borrowing this fixes.
alter table public.webhook_logs
  drop constraint if exists webhook_logs_single_subject;

alter table public.webhook_logs
  add constraint webhook_logs_single_subject
  check (payment_id is null or escrow_id is null);
