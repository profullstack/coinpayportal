-- Fix Supabase linter warnings:
-- 1. Set search_path on all public functions (security best practice)
-- 2. Drop stale create_notification if it exists

BEGIN;

-- Drop stale function if it exists (linter flagged it but may be orphaned)
DROP FUNCTION IF EXISTS public.create_notification CASCADE;

-- Set immutable search_path on all public functions to prevent search_path injection
-- This locks each function to only see the public and pg_catalog schemas explicitly

ALTER FUNCTION public.update_updated_at_column()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_escrows_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_payment_addresses_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_system_wallet_indexes_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_wallet_last_active()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.expire_old_payments()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.expire_pending_payments()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.cleanup_expired_challenges()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.initialize_merchant_settings()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.can_create_transaction(uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.get_current_month_usage(uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.get_pending_payments_for_monitoring(integer)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.get_wallet_balance_summary(uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.has_feature(uuid, text)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.increment_transaction_count(uuid)
  SET search_path = public, pg_catalog;

COMMIT;
