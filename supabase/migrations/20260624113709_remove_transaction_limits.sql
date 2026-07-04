-- Remove monthly transaction limits for all subscription plans.
-- NULL means unlimited (handled by can_create_transaction() and the
-- entitlements service/middleware). Previously the 'starter' plan was
-- capped at 100 transactions/month, which blocked merchants once they hit
-- the cap with a 429 "Monthly transaction limit reached" error.
UPDATE subscription_plans
SET monthly_transaction_limit = NULL
WHERE monthly_transaction_limit IS NOT NULL;
