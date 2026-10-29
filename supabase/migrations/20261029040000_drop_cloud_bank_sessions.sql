-- The cloud bank browser is off for good (lib/finances/cloud-disabled.ts).
-- A saved bank session is a live login that can move money: wipe every one.
-- Deliberately not backed up.
DELETE FROM public.finance_bank_sessions;
