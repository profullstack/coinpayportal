import { requireEncryptionKey } from '@/lib/crypto/require-key';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt, decrypt, deriveKey } from '../crypto/encryption';
import { generateApiKey } from '../auth/apikey';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { resolveWebhookSecret } from '../webhooks/secret';
import { getAccessibleBusinessRoles } from '../auth/authz';
import { can } from '../auth/permissions';
import {
  classifyBusiness,
  isValidCategory,
  normalizeTags,
  type Classification,
  type RiskFlag,
  type RiskLevel,
} from './taxonomy';

/**
 * Generate a secure webhook secret
 * Prefixed with 'whsecret_' to make it identifiable
 */
function generateWebhookSecret(): string {
  return `whsecret_${randomBytes(32).toString('hex')}`;
}

/**
 * Get decrypted webhook secret for a business
 */
export async function getWebhookSecret(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<{ success: boolean; secret?: string; error?: string }> {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('webhook_secret')
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Business not found',
      };
    }

    if (!business.webhook_secret) {
      return {
        success: false,
        error: 'No webhook secret configured',
      };
    }

    return {
      success: true,
      secret: resolveWebhookSecret(business.webhook_secret, merchantId),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get webhook secret',
    };
  }
}

/**
 * Regenerate webhook secret for a business
 */
export async function regenerateWebhookSecret(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<{ success: boolean; secret?: string; error?: string }> {
  try {
    // Generate new secret
    const newSecret = generateWebhookSecret();
    
    // Encrypt it
    const encryptionKey = getEncryptionKey();
    const derivedKey = deriveKey(encryptionKey, merchantId);
    const encryptedSecret = encrypt(newSecret, derivedKey);

    // Update business
    const { error } = await supabase
      .from('businesses')
      .update({ webhook_secret: encryptedSecret })
      .eq('id', businessId)
      .eq('merchant_id', merchantId);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      secret: newSecret,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to regenerate webhook secret',
    };
  }
}

/**
 * Validation schemas
 */
const businessNameSchema = z.string().min(1, 'Business name is required').max(100);
const webhookUrlSchema = z.string().url('Invalid webhook URL').optional();
const descriptionSchema = z.string().max(500).optional();

/**
 * Categorization is required on create so no business goes live unclassified.
 * The slug must exist in the taxonomy — see src/lib/business/taxonomy.ts.
 */
function validateCategory(category: unknown): string | undefined {
  if (!isValidCategory(category)) {
    return 'Select a valid business category';
  }
  return undefined;
}

/**
 * Run the classifier and turn it into the derived columns. Merchants never set
 * these directly — a merchant-supplied risk_level would be worthless.
 */
function classificationColumns(input: {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
}): {
  classification: Classification;
  columns: {
    category: string | null;
    tags: string[];
    risk_level: RiskLevel;
    risk_flags: RiskFlag[];
    review_status: string;
    classified_at: string;
  };
} {
  const classification = classifyBusiness(input);
  return {
    classification,
    columns: {
      category: classification.category,
      tags: classification.tags,
      risk_level: classification.riskLevel,
      risk_flags: classification.flags,
      review_status: classification.reviewRequired ? 'pending' : 'not_required',
      classified_at: new Date().toISOString(),
    },
  };
}

/**
 * Types
 */
export interface CreateBusinessInput {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  webhook_url?: string;
  webhook_secret?: string;
  webhook_events?: string[];
}

export interface UpdateBusinessInput {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  webhook_url?: string;
  webhook_secret?: string;
  webhook_events?: string[];
  active?: boolean;
}

export interface Business {
  id: string;
  merchant_id: string;
  name: string;
  description?: string;
  category?: string | null;
  tags?: string[];
  risk_level?: RiskLevel | null;
  risk_flags?: RiskFlag[];
  review_status?: string;
  classified_at?: string | null;
  webhook_url?: string;
  webhook_secret?: string;
  webhook_events?: string[];
  active: boolean;
  api_key?: string;
  api_key_created_at?: string;
  created_at: string;
  updated_at: string;
}

export interface BusinessResult {
  success: boolean;
  business?: Business;
  /** Present when this call (re)classified the business. */
  classification?: Classification;
  error?: string;
}

export interface BusinessListResult {
  success: boolean;
  businesses?: Business[];
  error?: string;
}

export interface BusinessFilters {
  /** Free text matched against name and description. */
  search?: string | null;
  /** Every one of these tags must be present. */
  tags?: string[] | null;
  category?: string | null;
  riskLevel?: string | null;
  reviewStatus?: string | null;
}

/** PostgREST treats these as operators inside `or(...)`, so they must go. */
function escapeForOr(value: string): string {
  return value.replace(/[,()]/g, ' ').trim();
}

/**
 * Apply search and facet filters to a `businesses` query. Shared by the merchant
 * list and the admin console so both understand the same query string.
 */
export function applyBusinessFilters<T>(query: T, filters: BusinessFilters): T {
  let q = query as any;

  const search = typeof filters.search === 'string' ? escapeForOr(filters.search) : '';
  if (search) {
    q = q.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  }

  const tags = normalizeTags(filters.tags ?? []);
  if (tags.length > 0) {
    // `contains` is an AND across the array — narrowing, which is what a tag
    // filter should do.
    q = q.contains('tags', tags);
  }

  if (filters.category) q = q.eq('category', filters.category);
  if (filters.riskLevel) q = q.eq('risk_level', filters.riskLevel);
  if (filters.reviewStatus) q = q.eq('review_status', filters.reviewStatus);

  return q as T;
}

/**
 * Get encryption key for business data
 */
function getEncryptionKey(): string {
  // Delegates to the shared guard, which additionally rejects malformed and
  // known-weak keys. The presence check this replaces accepted an all-zero key.
  return requireEncryptionKey('business data');
}

/**
 * Create a new business
 */
export async function createBusiness(
  supabase: SupabaseClient,
  merchantId: string,
  input: CreateBusinessInput
): Promise<BusinessResult> {
  try {
    // Validate name
    const nameResult = businessNameSchema.safeParse(input.name);
    if (!nameResult.success) {
      return {
        success: false,
        error: nameResult.error.errors[0].message,
      };
    }

    // Validate webhook URL if provided
    if (input.webhook_url) {
      const urlResult = webhookUrlSchema.safeParse(input.webhook_url);
      if (!urlResult.success) {
        return {
          success: false,
          error: urlResult.error.errors[0].message,
        };
      }
    }

    // Validate description if provided
    if (input.description) {
      const descResult = descriptionSchema.safeParse(input.description);
      if (!descResult.success) {
        return {
          success: false,
          error: descResult.error.errors[0].message,
        };
      }
    }

    // Categorize before anything else — an unclassified business should never
    // reach the point of collecting money.
    const categoryError = validateCategory(input.category);
    if (categoryError) {
      return {
        success: false,
        error: categoryError,
      };
    }

    const { classification, columns: classificationData } = classificationColumns({
      name: input.name,
      description: input.description,
      category: input.category,
      tags: input.tags,
    });

    // Generate and encrypt webhook secret if webhook URL is provided
    let encryptedSecret: string | undefined;
    if (input.webhook_url) {
      // Use provided secret or generate a new one
      const webhookSecret = input.webhook_secret || generateWebhookSecret();
      const encryptionKey = getEncryptionKey();
      const derivedKey = deriveKey(encryptionKey, merchantId);
      encryptedSecret = encrypt(webhookSecret, derivedKey);
    }

    // Generate API key for the new business
    const apiKey = generateApiKey();
    const apiKeyCreatedAt = new Date().toISOString();

    // Place the business in the owner's default organization so org-level team
    // members inherit access. Falls back to null (ungrouped) if not set.
    const { data: merchant } = await supabase
      .from('merchants')
      .select('default_org_id')
      .eq('id', merchantId)
      .maybeSingle();

    // Insert business
    const { data: business, error } = await supabase
      .from('businesses')
      .insert({
        merchant_id: merchantId,
        organization_id: merchant?.default_org_id ?? null,
        name: input.name,
        description: input.description,
        ...classificationData,
        webhook_url: input.webhook_url,
        webhook_secret: encryptedSecret,
        webhook_events: input.webhook_events || ['payment.confirmed', 'payment.forwarded'],
        active: true,
        api_key: apiKey,
        api_key_created_at: apiKeyCreatedAt,
      })
      .select()
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Failed to create business',
      };
    }

    return {
      success: true,
      business: business as Business,
      classification,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Business creation failed',
    };
  }
}

/**
 * List all businesses for a merchant
 */
export async function listBusinesses(
  supabase: SupabaseClient,
  merchantId: string
): Promise<BusinessListResult> {
  try {
    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('merchant_id', merchantId);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      businesses: (businesses || []) as Business[],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list businesses',
    };
  }
}

/**
 * List every business the merchant can access — owned plus those granted via org or
 * per-business team membership. Use this for team-aware list views; `listBusinesses`
 * remains owner-only for flows that must stay scoped to the account owner.
 */
export async function listAccessibleBusinesses(
  supabase: SupabaseClient,
  merchantId: string,
  filters: BusinessFilters = {}
): Promise<BusinessListResult> {
  try {
    const roleMap = await getAccessibleBusinessRoles(supabase, merchantId);
    const ids = [...roleMap.keys()];
    if (ids.length === 0) {
      return { success: true, businesses: [] };
    }

    let query = supabase.from('businesses').select('*').in('id', ids);
    query = applyBusinessFilters(query, filters);

    const { data: businesses, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    // Redact secrets per-business for members who cannot manage them.
    const redacted = (businesses || []).map((b: any) => {
      const role = roleMap.get(b.id);
      const out = { ...b };
      if (!can(role, 'apikey.manage')) delete out.api_key;
      if (!can(role, 'webhook.manage')) delete out.webhook_secret;
      return out;
    });

    return { success: true, businesses: redacted as Business[] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list businesses',
    };
  }
}

/**
 * Get a single business by ID
 */
export async function getBusiness(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<BusinessResult> {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Business not found',
      };
    }

    return {
      success: true,
      business: business as Business,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get business',
    };
  }
}

/**
 * Update a business
 */
export async function updateBusiness(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string,
  input: UpdateBusinessInput
): Promise<BusinessResult> {
  try {
    // Validate inputs if provided
    if (input.name !== undefined) {
      const nameResult = businessNameSchema.safeParse(input.name);
      if (!nameResult.success) {
        return {
          success: false,
          error: nameResult.error.errors[0].message,
        };
      }
    }

    if (input.webhook_url !== undefined && input.webhook_url !== null) {
      const urlResult = webhookUrlSchema.safeParse(input.webhook_url);
      if (!urlResult.success) {
        return {
          success: false,
          error: urlResult.error.errors[0].message,
        };
      }
    }

    if (input.description !== undefined && input.description !== null) {
      const descResult = descriptionSchema.safeParse(input.description);
      if (!descResult.success) {
        return {
          success: false,
          error: descResult.error.errors[0].message,
        };
      }
    }

    if (input.category !== undefined) {
      const categoryError = validateCategory(input.category);
      if (categoryError) {
        return {
          success: false,
          error: categoryError,
        };
      }
    }

    // Fetch current business to check if webhook URL has changed, and to
    // reclassify against the merged record rather than the partial patch.
    const { data: currentBusiness, error: fetchError } = await supabase
      .from('businesses')
      .select('webhook_url, webhook_secret, name, description, category, tags')
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .single();

    if (fetchError || !currentBusiness) {
      return {
        success: false,
        error: fetchError?.message || 'Business not found',
      };
    }

    // Prepare update data
    const updateData: any = {};

    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.webhook_url !== undefined) updateData.webhook_url = input.webhook_url;

    // Anything the classifier reads changing means the verdict is stale.
    let classification: Classification | undefined;
    const reclassify =
      input.name !== undefined ||
      input.description !== undefined ||
      input.category !== undefined ||
      input.tags !== undefined;

    if (reclassify) {
      const merged = classificationColumns({
        name: input.name ?? currentBusiness.name,
        description: input.description ?? currentBusiness.description,
        category: input.category ?? currentBusiness.category,
        tags: input.tags ?? currentBusiness.tags,
      });
      classification = merged.classification;
      Object.assign(updateData, merged.columns);
    }

    if (input.webhook_events !== undefined) updateData.webhook_events = input.webhook_events;
    if (input.active !== undefined) updateData.active = input.active;

    // Only generate new webhook secret if:
    // 1. A new webhook_url is being set and there's no existing secret, OR
    // 2. The webhook_url is actually changing to a different value
    const webhookUrlChanged = input.webhook_url && input.webhook_url !== currentBusiness.webhook_url;
    const needsNewSecret = webhookUrlChanged || (input.webhook_url && !currentBusiness.webhook_secret);

    if (needsNewSecret) {
      // Use provided secret or generate a new one
      const webhookSecret = input.webhook_secret || generateWebhookSecret();
      const encryptionKey = getEncryptionKey();
      const derivedKey = deriveKey(encryptionKey, merchantId);
      updateData.webhook_secret = encrypt(webhookSecret, derivedKey);
    } else if (input.webhook_secret) {
      // If only secret is being explicitly updated
      const encryptionKey = getEncryptionKey();
      const derivedKey = deriveKey(encryptionKey, merchantId);
      updateData.webhook_secret = encrypt(input.webhook_secret, derivedKey);
    }

    // Update business
    const { data: business, error } = await supabase
      .from('businesses')
      .update(updateData)
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .select()
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Failed to update business',
      };
    }

    return {
      success: true,
      business: business as Business,
      classification,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Business update failed',
    };
  }
}

export type TagOperation = 'replace' | 'add' | 'remove';

export interface TagsResult {
  success: boolean;
  tags?: string[];
  classification?: Classification;
  error?: string;
}

/**
 * Read the keyword tags on a business.
 */
export async function getBusinessTags(
  supabase: SupabaseClient,
  businessId: string
): Promise<TagsResult> {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('tags')
      .eq('id', businessId)
      .maybeSingle();

    if (error || !data) {
      return { success: false, error: error?.message || 'Business not found' };
    }
    return { success: true, tags: (data.tags as string[]) ?? [] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read tags',
    };
  }
}

/**
 * Add, remove or replace keyword tags, then reclassify.
 *
 * Tags feed the risk classifier, so every write here re-derives risk_level and
 * review_status — a business cannot quietly drop the "iptv" tag to shed its
 * rating, because the name and description still carry the signal.
 */
export async function mutateBusinessTags(
  supabase: SupabaseClient,
  businessId: string,
  operation: TagOperation,
  tags: string[]
): Promise<TagsResult> {
  try {
    const { data: current, error: fetchError } = await supabase
      .from('businesses')
      .select('name, description, category, tags')
      .eq('id', businessId)
      .maybeSingle();

    if (fetchError || !current) {
      return { success: false, error: fetchError?.message || 'Business not found' };
    }

    const incoming = normalizeTags(tags);
    const existing = normalizeTags((current.tags as string[]) ?? []);

    let nextTags: string[];
    if (operation === 'replace') {
      nextTags = incoming;
    } else if (operation === 'add') {
      nextTags = normalizeTags([...existing, ...incoming]);
    } else {
      const drop = new Set(incoming);
      nextTags = existing.filter((tag) => !drop.has(tag));
    }

    const { classification, columns } = classificationColumns({
      name: current.name,
      description: current.description,
      category: current.category,
      tags: nextTags,
    });

    const { data: updated, error } = await supabase
      .from('businesses')
      .update(columns)
      .eq('id', businessId)
      .select('tags')
      .single();

    if (error || !updated) {
      return { success: false, error: error?.message || 'Failed to update tags' };
    }

    return { success: true, tags: (updated.tags as string[]) ?? [], classification };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update tags',
    };
  }
}

/**
 * Delete a business
 */
export async function deleteBusiness(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('businesses')
      .delete()
      .eq('id', businessId)
      .eq('merchant_id', merchantId);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Business deletion failed',
    };
  }
}

/**
 * Regenerate API key for a business
 */
export async function regenerateApiKey(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<{ success: boolean; apiKey?: string; error?: string }> {
  try {
    // Generate new API key
    const newApiKey = generateApiKey();
    const apiKeyCreatedAt = new Date().toISOString();

    // Update business with new API key
    const { data: business, error } = await supabase
      .from('businesses')
      .update({
        api_key: newApiKey,
        api_key_created_at: apiKeyCreatedAt,
      })
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .select()
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Failed to regenerate API key',
      };
    }

    return {
      success: true,
      apiKey: newApiKey,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'API key regeneration failed',
    };
  }
}
