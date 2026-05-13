-- Address Supabase database-linter findings:
--   * rls_disabled_in_public on usage_credits / usage_rates / usage_log / usage_topups
--   * function_search_path_mutable on update_calendar_events_updated_at + generate_invoice_number
--   * rls_policy_always_true on mutual_attestations + stripe_webhook_secrets service-role policies
--   * rls_enabled_no_policy on webauthn_credentials and the OIDC tables

-- ============================================================
-- 1. Enable RLS + scope policies on usage_* billing tables
-- ============================================================

ALTER TABLE usage_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_rates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_topups  ENABLE ROW LEVEL SECURITY;

-- usage_credits: merchants who own the business see/manage rows for their business
DROP POLICY IF EXISTS "merchants_select_own_usage_credits" ON usage_credits;
CREATE POLICY "merchants_select_own_usage_credits" ON usage_credits
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

DROP POLICY IF EXISTS "service_role_all_usage_credits" ON usage_credits;
CREATE POLICY "service_role_all_usage_credits" ON usage_credits
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- usage_rates: same scoping
DROP POLICY IF EXISTS "merchants_select_own_usage_rates" ON usage_rates;
CREATE POLICY "merchants_select_own_usage_rates" ON usage_rates
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

DROP POLICY IF EXISTS "merchants_manage_own_usage_rates" ON usage_rates;
CREATE POLICY "merchants_manage_own_usage_rates" ON usage_rates
  FOR ALL TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

DROP POLICY IF EXISTS "service_role_all_usage_rates" ON usage_rates;
CREATE POLICY "service_role_all_usage_rates" ON usage_rates
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- usage_log: read-only for merchants, writes via service role
DROP POLICY IF EXISTS "merchants_select_own_usage_log" ON usage_log;
CREATE POLICY "merchants_select_own_usage_log" ON usage_log
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

DROP POLICY IF EXISTS "service_role_all_usage_log" ON usage_log;
CREATE POLICY "service_role_all_usage_log" ON usage_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- usage_topups: merchants see their own; service role records purchases
DROP POLICY IF EXISTS "merchants_select_own_usage_topups" ON usage_topups;
CREATE POLICY "merchants_select_own_usage_topups" ON usage_topups
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE merchant_id = auth.uid()));

DROP POLICY IF EXISTS "service_role_all_usage_topups" ON usage_topups;
CREATE POLICY "service_role_all_usage_topups" ON usage_topups
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 2. Pin search_path on flagged trigger / helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_calendar_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_business_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    next_num INT;
    result TEXT;
BEGIN
    SELECT COALESCE(
        MAX(
            CAST(
                SUBSTRING(invoice_number FROM 'INV-(\d+)')
                AS INT
            )
        ),
        0
    ) + 1 INTO next_num
    FROM invoices
    WHERE business_id = p_business_id;

    result := 'INV-' || LPAD(next_num::TEXT, 3, '0');
    RETURN result;
END;
$$;

-- ============================================================
-- 3. Replace permissive service-role policies (USING/WITH CHECK true)
--    with role-targeted policies — same effective access, but the
--    linter recognises TO service_role as scoped rather than open.
-- ============================================================

DROP POLICY IF EXISTS "Service role can insert attestations" ON mutual_attestations;
CREATE POLICY "service_role_insert_attestations" ON mutual_attestations
  FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON stripe_webhook_secrets;
CREATE POLICY "service_role_all_stripe_webhook_secrets" ON stripe_webhook_secrets
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 4. Add missing policies to RLS-enabled tables
--    (oauth_* tables already define policies in
--     20260317041000_oidc_rls_policies.sql, but the linter found
--     them missing — recreate idempotently to converge state.)
-- ============================================================

-- oauth_clients
DROP POLICY IF EXISTS "owners_select_own_clients" ON oauth_clients;
CREATE POLICY "owners_select_own_clients" ON oauth_clients
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owners_insert_clients" ON oauth_clients;
CREATE POLICY "owners_insert_clients" ON oauth_clients
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owners_update_own_clients" ON oauth_clients;
CREATE POLICY "owners_update_own_clients" ON oauth_clients
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owners_delete_own_clients" ON oauth_clients;
CREATE POLICY "owners_delete_own_clients" ON oauth_clients
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "service_role_all_clients" ON oauth_clients;
CREATE POLICY "service_role_all_clients" ON oauth_clients
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- oauth_authorization_codes
DROP POLICY IF EXISTS "users_select_own_codes" ON oauth_authorization_codes;
CREATE POLICY "users_select_own_codes" ON oauth_authorization_codes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "service_role_all_codes" ON oauth_authorization_codes;
CREATE POLICY "service_role_all_codes" ON oauth_authorization_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- oauth_refresh_tokens
DROP POLICY IF EXISTS "users_select_own_tokens" ON oauth_refresh_tokens;
CREATE POLICY "users_select_own_tokens" ON oauth_refresh_tokens
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "service_role_all_tokens" ON oauth_refresh_tokens;
CREATE POLICY "service_role_all_tokens" ON oauth_refresh_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- oauth_consents
DROP POLICY IF EXISTS "users_select_own_consents" ON oauth_consents;
CREATE POLICY "users_select_own_consents" ON oauth_consents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_delete_own_consents" ON oauth_consents;
CREATE POLICY "users_delete_own_consents" ON oauth_consents
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "service_role_all_consents" ON oauth_consents;
CREATE POLICY "service_role_all_consents" ON oauth_consents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- webauthn_credentials: only owner can see/manage their passkeys
DROP POLICY IF EXISTS "users_select_own_passkeys" ON webauthn_credentials;
CREATE POLICY "users_select_own_passkeys" ON webauthn_credentials
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_insert_own_passkeys" ON webauthn_credentials;
CREATE POLICY "users_insert_own_passkeys" ON webauthn_credentials
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_update_own_passkeys" ON webauthn_credentials;
CREATE POLICY "users_update_own_passkeys" ON webauthn_credentials
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_delete_own_passkeys" ON webauthn_credentials;
CREATE POLICY "users_delete_own_passkeys" ON webauthn_credentials
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "service_role_all_passkeys" ON webauthn_credentials;
CREATE POLICY "service_role_all_passkeys" ON webauthn_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);
