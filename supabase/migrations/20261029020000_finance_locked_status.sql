-- A connection whose credential is sealed to a locked secrets vault shows
-- last_sync_status 'locked' (#529). The original check only allowed
-- ok/partial/error, so the status write was silently refused.
alter table public.finance_connections drop constraint if exists finance_connections_last_sync_status_check;
alter table public.finance_connections
  add constraint finance_connections_last_sync_status_check check (last_sync_status = any (array['ok', 'partial', 'error', 'locked']));
