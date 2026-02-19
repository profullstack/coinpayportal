-- Add RLS policies for subscriptions table (had RLS enabled but no policies)

CREATE POLICY "Merchants can view their own subscriptions"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (merchant_id = auth.uid());

CREATE POLICY "Service role full access to subscriptions"
  ON subscriptions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
