-- CoinPay Merchant Settings and Email Queue Migration
-- This adds merchant notification preferences and email queue system

-- =====================================================
-- MERCHANT_SETTINGS TABLE
-- =====================================================
CREATE TABLE merchant_settings (
    merchant_id UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    notifications_enabled BOOLEAN DEFAULT true NOT NULL,
    email_notifications BOOLEAN DEFAULT true NOT NULL,
    web_notifications BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Index for faster lookups
CREATE INDEX idx_merchant_settings_merchant_id ON merchant_settings(merchant_id);

-- Trigger for updated_at
CREATE TRIGGER update_merchant_settings_updated_at 
    BEFORE UPDATE ON merchant_settings
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- EMAIL_QUEUE TABLE
-- =====================================================
CREATE TABLE email_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'payment.detected',
        'payment.confirmed',
        'payment.forwarded',
        'payment.failed'
    )),
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    html_body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'sent',
        'failed'
    )),
    attempts INTEGER DEFAULT 0 NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    next_retry_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for efficient queue processing
CREATE INDEX idx_email_queue_merchant_id ON email_queue(merchant_id);
CREATE INDEX idx_email_queue_payment_id ON email_queue(payment_id);
CREATE INDEX idx_email_queue_status ON email_queue(status);
CREATE INDEX idx_email_queue_next_retry ON email_queue(next_retry_at) 
    WHERE next_retry_at IS NOT NULL AND status = 'pending';
CREATE INDEX idx_email_queue_created_at ON email_queue(created_at DESC);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS
ALTER TABLE merchant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;

-- Merchant settings policies
CREATE POLICY "Merchants can view own settings"
    ON merchant_settings FOR SELECT
    USING (merchant_id = auth.uid());

CREATE POLICY "Merchants can insert own settings"
    ON merchant_settings FOR INSERT
    WITH CHECK (merchant_id = auth.uid());

CREATE POLICY "Merchants can update own settings"
    ON merchant_settings FOR UPDATE
    USING (merchant_id = auth.uid());

-- Email queue policies (merchants can view their own email logs)
CREATE POLICY "Merchants can view own email queue"
    ON email_queue FOR SELECT
    USING (merchant_id = auth.uid());

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to initialize default settings for new merchants
CREATE OR REPLACE FUNCTION initialize_merchant_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO merchant_settings (merchant_id)
    VALUES (NEW.id)
    ON CONFLICT (merchant_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create settings when merchant is created
CREATE TRIGGER create_merchant_settings_on_signup
    AFTER INSERT ON merchants
    FOR EACH ROW
    EXECUTE FUNCTION initialize_merchant_settings();

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE merchant_settings IS 'Merchant notification preferences and settings';
COMMENT ON TABLE email_queue IS 'Queue for reliable email delivery with retry logic';

COMMENT ON COLUMN merchant_settings.notifications_enabled IS 'Master toggle for all notifications';
COMMENT ON COLUMN merchant_settings.email_notifications IS 'Enable/disable email notifications';
COMMENT ON COLUMN merchant_settings.web_notifications IS 'Enable/disable web push notifications (future)';

COMMENT ON COLUMN email_queue.event_type IS 'Payment event that triggered the email';
COMMENT ON COLUMN email_queue.status IS 'Email delivery status: pending, sent, or failed';
COMMENT ON COLUMN email_queue.attempts IS 'Number of delivery attempts (max 3)';
COMMENT ON COLUMN email_queue.next_retry_at IS 'When to retry sending (exponential backoff)';