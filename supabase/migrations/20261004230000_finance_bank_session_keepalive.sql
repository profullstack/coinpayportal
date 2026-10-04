-- Finances: keep cloud bank sessions alive.
--
-- A bank's web session ends after some minutes without activity; the saved
-- cookies keep the device trusted (no MFA again) but not signed in. So CoinPay
-- "touches" each connected bank on a short interval: restore the session in a
-- fresh fenced browser, open the statements page, save the cookies the bank
-- rotated. When a bank ends the session anyway, the merchant is emailed once.

alter table public.finance_bank_sessions
  add column if not exists keepalive     boolean not null default true,
  add column if not exists last_touch_at timestamptz,
  add column if not exists next_touch_at timestamptz,
  add column if not exists notified_at   timestamptz;

create index if not exists finance_bank_sessions_touch_idx
  on public.finance_bank_sessions (next_touch_at)
  where state = 'active' and keepalive;
