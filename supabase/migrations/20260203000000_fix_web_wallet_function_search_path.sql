-- Migration: Fix Web Wallet Function Search Path Issues
-- This migration addresses Supabase security linter warnings for functions
-- created in 20260131000000_create_web_wallet_tables.sql that were missing
-- SET search_path = public
--
-- Affected functions:
-- 1. update_wallet_last_active
-- 2. cleanup_expired_challenges
-- 3. get_wallet_balance_summary
-- 4. update_updated_at_column (recreated without fix from 20260104)

-- =====================================================
-- FIX 1: update_wallet_last_active
-- Trigger function to update wallet's last_active_at on address/tx activity
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_wallet_last_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    UPDATE wallets
    SET last_active_at = NOW()
    WHERE id = NEW.wallet_id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_wallet_last_active() IS 
'Trigger function to update wallet last_active_at on address/transaction activity.
Fixed: Added SET search_path = public for security.';

-- =====================================================
-- FIX 2: cleanup_expired_challenges
-- Cron function to remove expired auth challenges
-- =====================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_challenges()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    DELETE FROM wallet_auth_challenges
    WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_challenges() IS 
'Removes expired wallet auth challenges older than 1 hour. Call via cron.
Fixed: Added SET search_path = public for security.';

-- =====================================================
-- FIX 3: get_wallet_balance_summary
-- Returns balance summary for all active addresses in a wallet
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_wallet_balance_summary(p_wallet_id UUID)
RETURNS TABLE (
    chain TEXT,
    address TEXT,
    balance NUMERIC,
    last_updated TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        wa.chain,
        wa.address,
        wa.cached_balance as balance,
        wa.cached_balance_updated_at as last_updated
    FROM wallet_addresses wa
    WHERE wa.wallet_id = p_wallet_id
    AND wa.is_active = true
    ORDER BY wa.chain, wa.derivation_index;
END;
$$;

COMMENT ON FUNCTION public.get_wallet_balance_summary(UUID) IS 
'Returns balance summary for all active addresses in a wallet.
Fixed: Added SET search_path = public for security.';

-- =====================================================
-- FIX 4: update_updated_at_column
-- Generic trigger function for updated_at columns
-- (Was overwritten by web wallet migration without search_path fix)
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at_column() IS 
'Generic trigger function to automatically update updated_at column.
Fixed: Added SET search_path = public for security.';
