-- Bring webhook_logs up to the schema the application code has been
-- silently writing to. The original 20251126135359_initial_schema.sql
-- created a minimal table {event,url,payload,response_status,response_body,
-- attempt,created_at,next_retry_at}, but logWebhookAttempt() in
-- src/lib/webhooks/service.ts writes {webhook_url,success,status_code,
-- error_message,attempt_number,response_time_ms} — columns that don't
-- exist. Every outbound webhook delivery has been silently failing to log
-- (and the new "Recent deliveries" panel in the merchant Webhooks tab
-- needs that data).
--
-- Also relax payment_id NOT NULL → NULLABLE so test-webhook deliveries
-- (no associated payment) can be logged.

ALTER TABLE webhook_logs
  ADD COLUMN IF NOT EXISTS webhook_url      text,
  ADD COLUMN IF NOT EXISTS success          boolean,
  ADD COLUMN IF NOT EXISTS status_code      integer,
  ADD COLUMN IF NOT EXISTS error_message    text,
  ADD COLUMN IF NOT EXISTS attempt_number   integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS response_time_ms integer;

ALTER TABLE webhook_logs
  ALTER COLUMN payment_id DROP NOT NULL;

-- Backfill: copy `url` → `webhook_url` and `response_status` → `status_code`
-- on existing rows so the UI has consistent data to render.
UPDATE webhook_logs
   SET webhook_url = COALESCE(webhook_url, url),
       status_code = COALESCE(status_code, response_status),
       success     = COALESCE(success, response_status BETWEEN 200 AND 299),
       attempt_number = COALESCE(attempt_number, attempt)
 WHERE webhook_url IS NULL OR status_code IS NULL OR success IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_logs_success
  ON webhook_logs(business_id, success, created_at DESC);

COMMENT ON TABLE webhook_logs IS
  'Outbound merchant webhook delivery attempts. One row per attempt (retries get separate rows). Written by sendPaymentWebhook → logWebhookAttempt; read by /api/webhooks for the merchant Webhooks tab.';
