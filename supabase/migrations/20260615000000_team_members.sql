-- Team members: organizations (group of businesses) + org/business membership + invitations.
--
-- coinpayportal enforces authorization in the APP LAYER (service-role client bypasses
-- RLS). Unlike crawlproof (Supabase Auth + auth.uid() RLS), the roles here are NOT
-- enforced by RLS policies — they are enforced by src/lib/auth/authz.ts. RLS is enabled
-- with NO policies so direct PostgREST (anon/authenticated) access is denied; all access
-- flows through API routes using the service-role key.
--
-- Model:
--   organizations  -- owns businesses; one default org backfilled per merchant
--   organization_members(merchant_id, role)  -- role applies to EVERY business in the org
--   business_members(merchant_id, role)      -- role applies to a SINGLE business
-- Roles: owner > admin > writer > readonly.

-- =====================================================
-- ORGANIZATIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_merchant_id, created_at DESC);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ORGANIZATION MEMBERS
-- =====================================================
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'readonly' CHECK (role IN ('owner', 'admin', 'writer', 'readonly')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_merchant ON organization_members(merchant_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_role ON organization_members(organization_id, role);

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- ORGANIZATION INVITATIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'readonly' CHECK (role IN ('admin', 'writer', 'readonly')),
    token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org ON organization_invitations(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON organization_invitations(email);

ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- BUSINESS MEMBERS
-- =====================================================
CREATE TABLE IF NOT EXISTS business_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'readonly' CHECK (role IN ('owner', 'admin', 'writer', 'readonly')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (business_id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_business_members_merchant ON business_members(merchant_id, business_id);
CREATE INDEX IF NOT EXISTS idx_business_members_biz_role ON business_members(business_id, role);

ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- BUSINESS INVITATIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS business_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'readonly' CHECK (role IN ('admin', 'writer', 'readonly')),
    token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (business_id, email)
);

CREATE INDEX IF NOT EXISTS idx_business_invites_biz ON business_invitations(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_invites_email ON business_invitations(email);

ALTER TABLE business_invitations ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- LINK COLUMNS
-- =====================================================
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_organization ON businesses(organization_id);

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS default_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- =====================================================
-- BACKFILL: one default org per existing merchant
-- =====================================================
INSERT INTO organizations (owner_merchant_id, name)
SELECT
    m.id,
    COALESCE(NULLIF(TRIM(m.name), ''), split_part(m.email, '@', 1), 'Workspace') || ' workspace'
FROM merchants m
WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.owner_merchant_id = m.id);

INSERT INTO organization_members (organization_id, merchant_id, role)
SELECT o.id, o.owner_merchant_id, 'owner'
FROM organizations o
ON CONFLICT (organization_id, merchant_id) DO UPDATE SET role = 'owner';

UPDATE merchants m
SET default_org_id = o.id
FROM (
    SELECT DISTINCT ON (owner_merchant_id) id, owner_merchant_id
    FROM organizations
    ORDER BY owner_merchant_id, created_at ASC
) o
WHERE m.id = o.owner_merchant_id
  AND m.default_org_id IS NULL;

UPDATE businesses b
SET organization_id = m.default_org_id
FROM merchants m
WHERE b.merchant_id = m.id
  AND b.organization_id IS NULL;

-- =====================================================
-- TRIGGER: auto-create default org for new merchants
-- =====================================================
CREATE OR REPLACE FUNCTION create_default_org_for_merchant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    IF NEW.default_org_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO organizations (owner_merchant_id, name)
    VALUES (
        NEW.id,
        COALESCE(NULLIF(TRIM(NEW.name), ''), split_part(NEW.email, '@', 1), 'Workspace') || ' workspace'
    )
    RETURNING id INTO v_org_id;

    INSERT INTO organization_members (organization_id, merchant_id, role)
    VALUES (v_org_id, NEW.id, 'owner')
    ON CONFLICT (organization_id, merchant_id) DO UPDATE SET role = 'owner';

    UPDATE merchants SET default_org_id = v_org_id WHERE id = NEW.id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchant_create_default_org ON merchants;
CREATE TRIGGER merchant_create_default_org
    AFTER INSERT ON merchants
    FOR EACH ROW EXECUTE FUNCTION create_default_org_for_merchant();
