-- Move White-label option from Professional to Enterprise tier
-- White-label is too complex to offer at $49/month, so it's now Enterprise-only

-- Update Professional plan to remove white_label feature
UPDATE subscription_plans 
SET white_label = false,
    updated_at = NOW()
WHERE id = 'professional';

-- Add comment explaining the change
COMMENT ON COLUMN subscription_plans.white_label IS 'White-label option - Enterprise tier only (requires custom pricing)';