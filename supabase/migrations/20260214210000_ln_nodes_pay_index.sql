-- Add last_pay_index to ln_nodes for payment monitor watermark
ALTER TABLE ln_nodes ADD COLUMN IF NOT EXISTS last_pay_index integer DEFAULT 0;
