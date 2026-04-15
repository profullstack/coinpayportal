-- Add platform_fee_amount column to stripe_transactions table
ALTER TABLE stripe_transactions ADD COLUMN IF NOT EXISTS platform_fee_amount numeric;
