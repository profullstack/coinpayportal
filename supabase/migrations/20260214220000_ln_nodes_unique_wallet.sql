-- Prevent duplicate LN nodes per wallet
-- First clean up any remaining duplicates (keep oldest)
DELETE FROM ln_nodes a
  USING ln_nodes b
  WHERE a.wallet_id = b.wallet_id
    AND a.created_at > b.created_at;

-- Add unique constraint
ALTER TABLE ln_nodes ADD CONSTRAINT ln_nodes_wallet_id_unique UNIQUE (wallet_id);
