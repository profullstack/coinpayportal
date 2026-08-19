-- IA-002 (verification follow-up): make the policy on `reputation_receipts`
-- say what the grants already enforce.
--
-- The table carries `SELECT ... USING (true)` for `anon, authenticated`, which
-- reads as "world-readable". It is not readable today only because neither role
-- holds a SELECT grant on it — RLS is evaluated *after* the grant check, so a
-- permissive policy on an ungranted table is inert.
--
-- That is a trap rather than a control. `GRANT SELECT ON ALL TABLES IN SCHEMA
-- public TO anon` is a routine Supabase incantation, and running it once would
-- publish every row of this table with no other change and no warning. As of
-- this migration that is 14,346 receipts carrying `agent_did`, `buyer_did`,
-- `escrow_tx`, and amounts totalling $1,050,924 — the platform's entire
-- transaction history, by counterparty and value.
--
-- Nothing reads this table through PostgREST today (the application uses the
-- service role, which bypasses RLS entirely), so narrowing the policy cannot
-- break a working path. It removes the discrepancy between what the policy
-- claims and what the deployment actually intends.
--
-- The sibling reputation tables are deliberately left alone: `mutual_attestations`,
-- `reputation_credentials` and `reputation_revocations` ARE granted to `anon`
-- and are the public, verifiable trust graph. That is the product working as
-- designed.

DROP POLICY IF EXISTS "Anyone can view reputation receipts" ON reputation_receipts;

CREATE POLICY "Service role manages reputation receipts"
    ON reputation_receipts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
