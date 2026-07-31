-- Proposals: a quote a business sends to a client that can be accepted,
-- rejected, or re-negotiated by either party before any money moves.
--
-- Shape mirrors the invoicing system so the two can share payee resolution,
-- authorization and email plumbing. The negotiation itself lives in
-- `proposal_revisions`: every offer and counter-offer is an immutable row, and
-- `proposals.current_revision_id` points at the one on the table. Accepting a
-- proposal converts the winning revision into a normal invoice.

BEGIN;

CREATE TABLE proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,

    proposal_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,

    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft',      -- being written, not visible to the client
        'sent',       -- with the client, awaiting their response
        'countered',  -- a counter-offer is on the table
        'accepted',   -- both parties agreed; convertible to an invoice
        'rejected',   -- declined outright
        'withdrawn',  -- pulled by the business
        'expired'     -- passed expires_at without resolution
    )),

    -- The revision currently under consideration. Nullable only between the
    -- INSERT of the proposal and its first revision (same transaction in
    -- application code).
    current_revision_id UUID,

    -- Opaque token that lets the client open and respond to the proposal
    -- without a CoinPay account. Rotated on withdraw.
    access_token TEXT NOT NULL UNIQUE,

    expires_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    accepted_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,

    -- Set once the accepted revision has been turned into an invoice.
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,

    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE proposal_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,

    -- 1-based, monotonic per proposal.
    revision_number INT NOT NULL,

    -- Which side put this offer on the table.
    proposed_by TEXT NOT NULL CHECK (proposed_by IN ('merchant', 'client')),
    -- Set for merchant-authored revisions; NULL when the client countered via
    -- the public access token.
    proposed_by_merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,

    amount NUMERIC(20, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    crypto_currency TEXT,

    -- Where the net settles if this revision is accepted. Required whenever
    -- crypto_currency is set — enforced by the CHECK below and by
    -- resolvePayee() in application code, which falls back to manual entry when
    -- no wallet can be derived from the account. A client counter that switches
    -- crypto_currency may leave this NULL; the merchant must then supply a
    -- payee before the proposal can be accepted.
    merchant_wallet_address TEXT,
    -- Where merchant_wallet_address came from: business | merchant_global |
    -- web_wallet | manual | inherited.
    payee_source TEXT,

    terms TEXT,
    message TEXT,
    due_date TIMESTAMP WITH TIME ZONE,

    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open',        -- awaiting the other party
        'accepted',
        'rejected',
        'superseded'   -- replaced by a later counter-offer
    )),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT proposal_revision_amount_positive CHECK (amount > 0),
    CONSTRAINT unique_proposal_revision_number UNIQUE (proposal_id, revision_number),
    -- A merchant-authored crypto revision must always name a payee. Client
    -- counters are exempt: they cannot see the merchant's wallets, so the
    -- merchant fills the gap before accepting.
    CONSTRAINT proposal_revision_merchant_payee_required CHECK (
        proposed_by <> 'merchant'
        OR crypto_currency IS NULL
        OR (merchant_wallet_address IS NOT NULL AND length(trim(merchant_wallet_address)) > 0)
    )
);

ALTER TABLE proposals
    ADD CONSTRAINT proposals_current_revision_fk
    FOREIGN KEY (current_revision_id) REFERENCES proposal_revisions(id) ON DELETE SET NULL;

-- Append-only audit trail of everything that happened on a proposal, so both
-- parties can see the negotiation history.
CREATE TABLE proposal_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    revision_id UUID REFERENCES proposal_revisions(id) ON DELETE SET NULL,

    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'sent', 'viewed', 'countered',
        'accepted', 'rejected', 'withdrawn', 'expired', 'invoiced'
    )),
    actor TEXT NOT NULL CHECK (actor IN ('merchant', 'client', 'system')),
    actor_merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,

    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_proposals_user_id ON proposals(user_id);
CREATE INDEX idx_proposals_business_id ON proposals(business_id);
CREATE INDEX idx_proposals_client_id ON proposals(client_id);
CREATE INDEX idx_proposals_status ON proposals(status);
CREATE UNIQUE INDEX idx_proposals_business_proposal_number
    ON proposals(business_id, proposal_number);

CREATE INDEX idx_proposal_revisions_proposal_id ON proposal_revisions(proposal_id);
CREATE INDEX idx_proposal_revisions_status ON proposal_revisions(status);

CREATE INDEX idx_proposal_events_proposal_id ON proposal_events(proposal_id, created_at DESC);

-- RLS. Server routes use the service role and authorize by business role; these
-- policies cover direct owner access, matching the invoices table.
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own proposals"
    ON proposals FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert their own proposals"
    ON proposals FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update their own proposals"
    ON proposals FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete their own proposals"
    ON proposals FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "Users can view revisions of their proposals"
    ON proposal_revisions FOR SELECT
    USING (proposal_id IN (SELECT id FROM proposals WHERE user_id = auth.uid()));
CREATE POLICY "Users can insert revisions on their proposals"
    ON proposal_revisions FOR INSERT
    WITH CHECK (proposal_id IN (SELECT id FROM proposals WHERE user_id = auth.uid()));

CREATE POLICY "Users can view events of their proposals"
    ON proposal_events FOR SELECT
    USING (proposal_id IN (SELECT id FROM proposals WHERE user_id = auth.uid()));

COMMIT;
