-- Track when a merchant last signed in, so the app can send someone who has been
-- away for a while to their wallet settings before they start invoicing.
--
-- A stale payee is worse than a missing one: an address that was right six months
-- ago may now belong to a wallet the user no longer controls. Reviewing wallets
-- after a lapse is cheap; discovering it after a payout is not.

BEGIN;

ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
    -- Set when the user actually looks at /settings/wallets, so the prompt is
    -- not shown again on every page load of the same session.
    ADD COLUMN IF NOT EXISTS wallets_reviewed_at TIMESTAMP WITH TIME ZONE;

COMMIT;
