-- Invoicing System Migration
-- Creates clients, invoices, and invoice_schedules tables with RLS policies

-- =====================================================
-- CLIENTS TABLE
-- =====================================================
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    website TEXT,
    company_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_clients_business_id ON clients(business_id);
CREATE INDEX idx_clients_email ON clients(email);

-- RLS for clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own clients"
    ON clients FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own clients"
    ON clients FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own clients"
    ON clients FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own clients"
    ON clients FOR DELETE
    USING (user_id = auth.uid());

-- =====================================================
-- INVOICES TABLE
-- =====================================================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'sent', 'paid', 'overdue', 'cancelled'
    )),
    currency TEXT NOT NULL DEFAULT 'USD',
    amount NUMERIC(20, 2) NOT NULL,
    crypto_currency TEXT,
    crypto_amount TEXT,
    payment_address TEXT,
    merchant_wallet_address TEXT,
    wallet_id UUID,
    fee_rate NUMERIC(10, 6) DEFAULT 0.01,
    fee_amount NUMERIC(20, 8),
    due_date TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    tx_hash TEXT,
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_business_id ON invoices(business_id);
CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_payment_address ON invoices(payment_address);
CREATE UNIQUE INDEX idx_invoices_business_invoice_number ON invoices(business_id, invoice_number);

-- RLS for invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own invoices"
    ON invoices FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own invoices"
    ON invoices FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own invoices"
    ON invoices FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own invoices"
    ON invoices FOR DELETE
    USING (user_id = auth.uid());

-- =====================================================
-- INVOICE_SCHEDULES TABLE
-- =====================================================
CREATE TABLE invoice_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    recurrence TEXT NOT NULL CHECK (recurrence IN (
        'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'
    )),
    custom_interval_days INT,
    next_due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    max_occurrences INT,
    occurrences_count INT DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_invoice_schedules_invoice_id ON invoice_schedules(invoice_id);
CREATE INDEX idx_invoice_schedules_next_due_date ON invoice_schedules(next_due_date);
CREATE INDEX idx_invoice_schedules_active ON invoice_schedules(active);

-- RLS for invoice_schedules (through invoice ownership)
ALTER TABLE invoice_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own invoice schedules"
    ON invoice_schedules FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM invoices WHERE invoices.id = invoice_schedules.invoice_id AND invoices.user_id = auth.uid()
    ));

CREATE POLICY "Users can insert their own invoice schedules"
    ON invoice_schedules FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM invoices WHERE invoices.id = invoice_schedules.invoice_id AND invoices.user_id = auth.uid()
    ));

CREATE POLICY "Users can update their own invoice schedules"
    ON invoice_schedules FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM invoices WHERE invoices.id = invoice_schedules.invoice_id AND invoices.user_id = auth.uid()
    ));

CREATE POLICY "Users can delete their own invoice schedules"
    ON invoice_schedules FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM invoices WHERE invoices.id = invoice_schedules.invoice_id AND invoices.user_id = auth.uid()
    ));

-- =====================================================
-- FUNCTION: Generate next invoice number for a business
-- =====================================================
CREATE OR REPLACE FUNCTION generate_invoice_number(p_business_id UUID)
RETURNS TEXT AS $$
DECLARE
    next_num INT;
    result TEXT;
BEGIN
    SELECT COALESCE(
        MAX(
            CAST(
                SUBSTRING(invoice_number FROM 'INV-(\d+)')
                AS INT
            )
        ),
        0
    ) + 1 INTO next_num
    FROM invoices
    WHERE business_id = p_business_id;
    
    result := 'INV-' || LPAD(next_num::TEXT, 3, '0');
    RETURN result;
END;
$$ LANGUAGE plpgsql;
