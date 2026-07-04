/**
 * W5 payment method configuration cascade — shared types.
 * See supabase/migrations/20260704180000_payment_method_config_cascade.sql.
 */

export type BusinessMethodStatus = 'unlocked' | 'blocked' | 'pending_review';

export interface CatalogMethod {
  methodId: string;
  displayName: string;
  integrationType: string;
  published: boolean;
  forceDisabled: boolean;
  defaultConfig: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  sortOrder: number;
}

export interface BusinessPolicy {
  methodId: string;
  status: BusinessMethodStatus;
  entityParams: Record<string, unknown>;
}

export interface MerchantSetting {
  methodId: string;
  enabled: boolean;
  minOrderValue: number | null;
  maxOrderValue: number | null;
  currencyAllowlist: string[] | null;
  displayOrder: number | null;
}

/**
 * The merged, checkout-ready shape for one method after the three layers are
 * resolved. Only methods that survive the restrict-only cascade appear.
 */
export interface EffectiveMethod {
  methodId: string;
  displayName: string;
  integrationType: string;
  minOrderValue: number | null;
  maxOrderValue: number | null;
  currencyAllowlist: string[] | null;
  sortOrder: number;
  /** catalog.default_config merged under business.entity_params. */
  config: Record<string, unknown>;
}
