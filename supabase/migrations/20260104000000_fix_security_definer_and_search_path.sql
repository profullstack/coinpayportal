-- Migration: Fix Security Definer View and Function Search Path Issues
-- This migration addresses Supabase security linter warnings:
-- 1. ERROR: security_definer_view - payment_monitoring_stats view
-- 2. WARN: function_search_path_mutable - 11 functions without search_path set

-- =====================================================
-- FIX 1: SECURITY DEFINER VIEW
-- Recreate payment_monitoring_stats view without SECURITY DEFINER
-- This ensures the view uses the permissions of the querying user
-- =====================================================

DROP VIEW IF EXISTS payment_monitoring_stats;

CREATE VIEW payment_monitoring_stats
WITH (security_invoker = true) AS
SELECT 
    COUNT(*) FILTER (WHERE status = 'pending' AND expires_at > NOW()) AS active_pending,
    COUNT(*) FILTER (WHERE status = 'pending' AND expires_at <= NOW()) AS expired_pending,
    COUNT(*) FILTER (WHERE status = 'confirmed') AS awaiting_forward,
    COUNT(*) FILTER (WHERE status = 'forwarding') AS currently_forwarding,
    COUNT(*) FILTER (WHERE status = 'forwarded' AND updated_at > NOW() - INTERVAL '1 hour') AS recently_forwarded,
    COUNT(*) FILTER (WHERE status = 'expired' AND updated_at > NOW() - INTERVAL '1 hour') AS recently_expired,
    COUNT(*) FILTER (WHERE status = 'forwarding_failed') AS failed_forwarding
FROM public.payments;

-- Grant access to the view
GRANT SELECT ON payment_monitoring_stats TO authenticated;
GRANT SELECT ON payment_monitoring_stats TO service_role;

COMMENT ON VIEW payment_monitoring_stats IS 'Aggregated payment monitoring statistics with SECURITY INVOKER (uses querying user permissions)';

-- =====================================================
-- FIX 2: FUNCTION SEARCH PATH MUTABLE
-- Recreate all functions with SET search_path = public
-- This prevents search_path manipulation attacks
-- =====================================================

-- 2.1: expire_pending_payments (from 20251127050000_add_payment_monitoring.sql)
CREATE OR REPLACE FUNCTION public.expire_pending_payments()
RETURNS TABLE (
    expired_count INTEGER,
    payment_ids UUID[]
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_expired_count INTEGER;
    v_payment_ids UUID[];
BEGIN
    -- Get IDs of payments to expire
    SELECT ARRAY_AGG(id) INTO v_payment_ids
    FROM public.payments
    WHERE status = 'pending'
    AND expires_at < NOW();
    
    -- Update status to expired
    UPDATE public.payments
    SET 
        status = 'expired',
        updated_at = NOW()
    WHERE status = 'pending'
    AND expires_at < NOW();
    
    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    
    RETURN QUERY SELECT v_expired_count, COALESCE(v_payment_ids, ARRAY[]::UUID[]);
END;
$$;

-- 2.2: get_pending_payments_for_monitoring (from 20251127050000_add_payment_monitoring.sql)
CREATE OR REPLACE FUNCTION public.get_pending_payments_for_monitoring(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
    id UUID,
    business_id UUID,
    blockchain TEXT,
    crypto_amount NUMERIC,
    status TEXT,
    payment_address TEXT,
    created_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    merchant_wallet_address TEXT,
    time_remaining INTERVAL
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.business_id,
        p.blockchain,
        p.crypto_amount,
        p.status,
        p.payment_address,
        p.created_at,
        p.expires_at,
        p.merchant_wallet_address,
        (p.expires_at - NOW()) AS time_remaining
    FROM public.payments p
    WHERE p.status = 'pending'
    AND p.expires_at > NOW()
    AND p.payment_address IS NOT NULL
    ORDER BY p.created_at ASC
    LIMIT p_limit;
END;
$$;

-- 2.3: can_create_transaction (from 20251127020000_add_subscription_entitlements.sql)
CREATE OR REPLACE FUNCTION public.can_create_transaction(p_merchant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_plan_limit INTEGER;
    v_current_usage INTEGER;
    v_subscription_status TEXT;
BEGIN
    -- Get merchant's plan limit and status
    SELECT sp.monthly_transaction_limit, m.subscription_status
    INTO v_plan_limit, v_subscription_status
    FROM public.merchants m
    JOIN public.subscription_plans sp ON m.subscription_plan_id = sp.id
    WHERE m.id = p_merchant_id;
    
    -- Check subscription status
    IF v_subscription_status != 'active' AND v_subscription_status != 'trialing' THEN
        RETURN FALSE;
    END IF;
    
    -- NULL limit means unlimited
    IF v_plan_limit IS NULL THEN
        RETURN TRUE;
    END IF;
    
    -- Get current usage
    v_current_usage := public.get_current_month_usage(p_merchant_id);
    
    RETURN v_current_usage < v_plan_limit;
END;
$$;

-- 2.4: has_feature (from 20251127020000_add_subscription_entitlements.sql)
CREATE OR REPLACE FUNCTION public.has_feature(p_merchant_id UUID, p_feature TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_has_feature BOOLEAN;
BEGIN
    EXECUTE format(
        'SELECT sp.%I FROM public.merchants m JOIN public.subscription_plans sp ON m.subscription_plan_id = sp.id WHERE m.id = $1',
        p_feature
    ) INTO v_has_feature USING p_merchant_id;
    
    RETURN COALESCE(v_has_feature, FALSE);
END;
$$;

-- 2.5: update_updated_at_column (from 20251126135359_initial_schema.sql)
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

-- 2.6: update_payment_addresses_updated_at (from 20251127040000_add_system_wallet_support.sql)
CREATE OR REPLACE FUNCTION public.update_payment_addresses_updated_at()
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

-- 2.7: expire_old_payments (from 20251126135359_initial_schema.sql)
CREATE OR REPLACE FUNCTION public.expire_old_payments()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    UPDATE public.payments
    SET status = 'expired'
    WHERE status = 'pending'
    AND expires_at < NOW();
END;
$$;

-- 2.8: initialize_merchant_settings (from 20251126202700_add_merchant_settings_and_email_queue.sql)
CREATE OR REPLACE FUNCTION public.initialize_merchant_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.merchant_settings (merchant_id)
    VALUES (NEW.id)
    ON CONFLICT (merchant_id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- 2.9: get_current_month_usage (from 20251127020000_add_subscription_entitlements.sql)
CREATE OR REPLACE FUNCTION public.get_current_month_usage(p_merchant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
    v_year_month TEXT;
BEGIN
    v_year_month := TO_CHAR(NOW(), 'YYYY-MM');
    
    SELECT transaction_count INTO v_count
    FROM public.monthly_usage
    WHERE merchant_id = p_merchant_id AND year_month = v_year_month;
    
    RETURN COALESCE(v_count, 0);
END;
$$;

-- 2.10: increment_transaction_count (from 20251127020000_add_subscription_entitlements.sql)
CREATE OR REPLACE FUNCTION public.increment_transaction_count(p_merchant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
    v_year_month TEXT;
BEGIN
    v_year_month := TO_CHAR(NOW(), 'YYYY-MM');
    
    INSERT INTO public.monthly_usage (merchant_id, year_month, transaction_count)
    VALUES (p_merchant_id, v_year_month, 1)
    ON CONFLICT (merchant_id, year_month)
    DO UPDATE SET 
        transaction_count = public.monthly_usage.transaction_count + 1,
        updated_at = NOW()
    RETURNING transaction_count INTO v_count;
    
    RETURN v_count;
END;
$$;

-- 2.11: update_system_wallet_indexes_updated_at (from 20251127040000_add_system_wallet_support.sql)
CREATE OR REPLACE FUNCTION public.update_system_wallet_indexes_updated_at()
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

-- =====================================================
-- UPDATE COMMENTS
-- =====================================================

COMMENT ON FUNCTION public.expire_pending_payments() IS 
'Automatically expires pending payments that have exceeded their 15-minute window. 
Should be called periodically via pg_cron or the monitor-payments edge function.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.get_pending_payments_for_monitoring(INTEGER) IS 
'Returns pending payments that need to be checked for incoming blockchain transactions.
Used by the monitor-payments edge function.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.can_create_transaction(UUID) IS 
'Checks if a merchant can create a new transaction based on their subscription plan limits.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.has_feature(UUID, TEXT) IS 
'Checks if a merchant has access to a specific feature based on their subscription plan.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.update_updated_at_column() IS 
'Trigger function to automatically update the updated_at column.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.update_payment_addresses_updated_at() IS 
'Trigger function to update payment_addresses.updated_at column.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.expire_old_payments() IS 
'Expires pending payments that have passed their expiration time.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.initialize_merchant_settings() IS 
'Trigger function to create default settings when a new merchant is created.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.get_current_month_usage(UUID) IS 
'Returns the current month transaction count for a merchant.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.increment_transaction_count(UUID) IS 
'Increments the transaction count for a merchant in the current month.
Fixed: Added SET search_path = public for security.';

COMMENT ON FUNCTION public.update_system_wallet_indexes_updated_at() IS 
'Trigger function to update system_wallet_indexes.updated_at column.
Fixed: Added SET search_path = public for security.';
