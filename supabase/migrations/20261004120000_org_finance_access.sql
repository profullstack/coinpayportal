-- Finance access for organization teammates.
--
-- A teammate's org role (readonly/writer/admin) already governs the businesses in
-- the org. Bank and card data (/finances) belongs to the org OWNER, and is far more
-- sensitive than payment records, so it is a separate opt-in per member: a
-- developer invited as `writer` must not see the owner's bank feed just because
-- they can edit invoices. Only the org owner can grant it (see src/lib/team/service.ts),
-- and the member's role then caps what they can do there (src/lib/finances/access.ts).

ALTER TABLE organization_members
    ADD COLUMN IF NOT EXISTS finance_access BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE organization_invitations
    ADD COLUMN IF NOT EXISTS finance_access BOOLEAN NOT NULL DEFAULT false;
