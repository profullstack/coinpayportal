-- Team additions need the owner's approval (2026-10-29 incident).
--
-- Accepting an invitation used to create the membership on the spot, so any
-- admin (or anyone holding a business API key, which acted as the owner) could
-- invite an address they controlled and be on the team a minute later. Now an
-- accepted invitation only records who accepted it; the membership is created
-- when the owner approves it in Settings -> Team.

ALTER TABLE organization_invitations
  ADD COLUMN IF NOT EXISTS accepted_by_merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES merchants(id) ON DELETE SET NULL;

ALTER TABLE business_invitations
  ADD COLUMN IF NOT EXISTS accepted_by_merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES merchants(id) ON DELETE SET NULL;

-- Invitations accepted before this change already became memberships: mark them
-- settled so they never show up as waiting for approval.
UPDATE organization_invitations SET approved_at = accepted_at WHERE accepted_at IS NOT NULL AND approved_at IS NULL;
UPDATE business_invitations SET approved_at = accepted_at WHERE accepted_at IS NOT NULL AND approved_at IS NULL;
