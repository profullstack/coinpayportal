-- Add deposit_tx_hash column to track the deposit transaction
ALTER TABLE swaps ADD COLUMN IF NOT EXISTS deposit_tx_hash TEXT;

-- Comment
COMMENT ON COLUMN swaps.deposit_tx_hash IS 'Transaction hash of the deposit sent to the swap provider';
