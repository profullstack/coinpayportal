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
-- publish every row of this table with no other change and no warning.
--
-- Scale, for proportion: 14,346 rows, of which 14,333 are `did:web:ugig.net`
-- reputation receipts totalling $921.03. These are ugig.net's agent trust graph,
-- not CoinPay payment records — those live in `payments` and are not affected.
-- The point of this migration is that the policy should say what the grants
-- already enforce, not that anything valuable was at risk.
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
