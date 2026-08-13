/**
 * Fraud scoring rules.
 *
 * Pure functions over a snapshot the caller has already gathered. Each rule
 * contributes score; the total maps to a decision. Nothing here touches the
 * database or the network so the thresholds can be exercised directly.
 */

import type { RiskLevel } from '../business/taxonomy';
import type { MisrepresentationResult } from './misrepresentation';
import { isDisposableEmail } from './signals';

export type Decision = 'allow' | 'verify' | 'block';

export interface Finding {
  code: string;
  label: string;
  score: number;
  /** Detail for the reviewer — never shown to the buyer. */
  detail?: string;
}

/** Score at or above which we stop the payment outright. */
export const BLOCK_THRESHOLD = 70;
/** Score at or above which we force 3-D Secure instead of blocking. */
export const VERIFY_THRESHOLD = 35;

export interface VelocitySnapshot {
  /** Checkout attempts from this IP in the last 10 minutes. */
  attemptsPerIp10m: number;
  /** Distinct normalized buyer emails seen on this IP in the last hour. */
  distinctEmailsPerIp1h: number;
  /** Checkout attempts for this buyer email in the last 10 minutes. */
  attemptsPerEmail10m: number;
  /** Declines for this business in the last hour. */
  declinesPerBusiness1h: number;
  /** Declines from this IP in the last hour. */
  declinesPerIp1h: number;
  /** Attempts under $5 for this business in the last 10 minutes. */
  smallAmountAttempts10m: number;
  /** Disputes raised against this business in the last 30 days. */
  disputesPerBusiness30d: number;
}

export interface MerchantSnapshot {
  riskLevel: RiskLevel | null;
  reviewStatus: string | null;
  category: string | null;
  /** Businesses that share an identity signal with this one. */
  linkedBusinessIds: string[];
  /** True when any linked business is blocklisted or prohibited. */
  linkedToBlockedBusiness: boolean;
}

export interface ScoringInput {
  velocity: VelocitySnapshot;
  merchant: MerchantSnapshot;
  misrepresentation?: MisrepresentationResult | null;
  email: string | null;
  amount: number | null;
  /** A blocklist entry that already matched, if any. */
  blocklistAction?: 'block' | 'verify' | null;
  blocklistReason?: string | null;
}

export interface ScoringResult {
  decision: Decision;
  score: number;
  findings: Finding[];
}

/**
 * Card testers run many small charges through one merchant to find live
 * numbers. The thresholds below are deliberately conservative: a real store
 * doing five checkouts a minute from one IP is already unusual.
 */
export function scoreCheckout(input: ScoringInput): ScoringResult {
  const findings: Finding[] = [];
  const add = (code: string, label: string, score: number, detail?: string) => {
    findings.push({ code, label, score, detail });
  };

  const { velocity: v, merchant: m } = input;

  // ---------------------------------------------------------------- overrides
  if (input.blocklistAction === 'block') {
    return {
      decision: 'block',
      score: 100,
      findings: [
        {
          code: 'blocklist',
          label: 'Blocklist match',
          score: 100,
          detail: input.blocklistReason || undefined,
        },
      ],
    };
  }

  if (input.blocklistAction === 'verify') {
    add('blocklist-verify', 'Blocklist match (verify)', VERIFY_THRESHOLD, input.blocklistReason || undefined);
  }

  // ----------------------------------------------------------- merchant risk
  if (m.riskLevel === 'prohibited') {
    add('merchant-prohibited', 'Merchant category is not supported', 100);
  } else if (m.riskLevel === 'high') {
    add('merchant-high-risk', 'Merchant is high risk', 25, `category=${m.category ?? 'none'}`);
  }

  if (m.reviewStatus === 'pending') {
    add('merchant-pending-review', 'Merchant has not cleared review', 15);
  } else if (m.reviewStatus === 'rejected') {
    add('merchant-rejected', 'Merchant was rejected in review', 100);
  }

  if (m.linkedToBlockedBusiness) {
    add(
      'linked-to-blocked',
      'Shares identity signals with a blocked business',
      45,
      `linked=${m.linkedBusinessIds.join(',')}`
    );
  }

  // ------------------------------------------------------- misrepresentation
  const mis = input.misrepresentation;
  if (mis?.mismatch) {
    // Selling something riskier than declared is the strongest merchant-side
    // signal we have — it is deliberate, not incidental. On its own this is
    // enough to force 3-D Secure on everything the merchant takes.
    const score = mis.observedRisk === 'prohibited' ? 60 : VERIFY_THRESHOLD;
    add(
      'category-misrepresentation',
      'Activity does not match the declared category',
      score,
      `declared=${mis.declaredCategory ?? 'none'} observed=${mis.observedCategories.join(',')} keywords=${mis.matchedKeywords.join(',')}`
    );
  }

  // ------------------------------------------------------------- velocity
  if (v.distinctEmailsPerIp1h >= 6) {
    add('ip-many-emails', 'Many different buyers from one IP', 45, `${v.distinctEmailsPerIp1h} emails/hour`);
  } else if (v.distinctEmailsPerIp1h >= 3) {
    add('ip-several-emails', 'Several different buyers from one IP', 25, `${v.distinctEmailsPerIp1h} emails/hour`);
  }

  if (v.attemptsPerIp10m >= 10) {
    add('ip-burst', 'Burst of attempts from one IP', 40, `${v.attemptsPerIp10m} in 10min`);
  } else if (v.attemptsPerIp10m >= 5) {
    add('ip-rapid', 'Rapid attempts from one IP', 25, `${v.attemptsPerIp10m} in 10min`);
  }

  if (v.attemptsPerEmail10m >= 4) {
    add('email-retries', 'Repeated attempts from one buyer', 20, `${v.attemptsPerEmail10m} in 10min`);
  }

  // ----------------------------------------------------------- card testing
  if (v.declinesPerIp1h >= 3) {
    add('ip-declines', 'Declined cards from this IP', 40, `${v.declinesPerIp1h} in 1h`);
  }

  if (v.declinesPerBusiness1h >= 10) {
    add('merchant-declines-high', 'Heavy decline rate on this merchant', 40, `${v.declinesPerBusiness1h} in 1h`);
  } else if (v.declinesPerBusiness1h >= 5) {
    add('merchant-declines', 'Elevated decline rate on this merchant', 25, `${v.declinesPerBusiness1h} in 1h`);
  }

  if (v.smallAmountAttempts10m >= 3) {
    add(
      'small-amount-burst',
      'Burst of small charges',
      25,
      `${v.smallAmountAttempts10m} under $5 in 10min`
    );
  }

  if (v.disputesPerBusiness30d >= 3) {
    add('merchant-disputes', 'Merchant has recent disputes', 20, `${v.disputesPerBusiness30d} in 30d`);
  }

  // -------------------------------------------------------------- buyer
  if (isDisposableEmail(input.email)) {
    add('disposable-email', 'Disposable email address', 20);
  }

  if (!input.email) {
    add('no-email', 'No buyer email supplied', 10);
  }

  const score = Math.min(100, findings.reduce((total, f) => total + f.score, 0));

  let decision: Decision = 'allow';
  if (score >= BLOCK_THRESHOLD) decision = 'block';
  else if (score >= VERIFY_THRESHOLD) decision = 'verify';

  findings.sort((a, b) => b.score - a.score);

  return { decision, score, findings };
}
