-- Rename greenlight_node_id to lnbits_wallet_id (Greenlight deprecated)
ALTER TABLE ln_nodes RENAME COLUMN greenlight_node_id TO lnbits_wallet_id;
