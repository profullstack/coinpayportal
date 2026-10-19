-- Weekly payments report: the default account report for merchants with no
-- bank linked in Finances.
--
-- Seven days of crypto payments and invoices, Monday and Friday 08:00 in the
-- merchant's timezone (America/Los_Angeles when none is saved), to their own
-- login address. The app creates it (`daily-subscriptions.ts`) for every
-- merchant with a settled payment or a sent/paid/overdue invoice in the last
-- 90 days, no live finance connection, email notifications on and not on the
-- fraud blocklist. A week with no activity sends nothing.
--
-- 1. `weekly_payments` joins the schedule kinds.
-- 2. `weekly_payments_opted_out_at`: set by the settings toggle, DELETE,
--    `active: false` and the one-click link in every email. While set,
--    nothing automatic creates it again.
--
-- Additive only.

alter table public.finance_email_schedules drop constraint if exists finance_email_schedules_kind_check;
alter table public.finance_email_schedules
  add constraint finance_email_schedules_kind_check
  check (kind in ('weekly_digest', 'daily_summary', 'weekly_payments'));

alter table public.finance_email_preferences
  add column if not exists weekly_payments_opted_out_at timestamptz;

comment on column public.finance_email_preferences.weekly_payments_opted_out_at is
  'When the owner turned the weekly payments report off or unsubscribed. While set, it is never re-created automatically.';
