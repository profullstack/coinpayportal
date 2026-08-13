/**
 * Checkout screening — the entry point called before we hand a buyer a Stripe
 * Checkout URL.
 *
 * With Stripe Checkout the card never touches our servers, so "before Stripe"
 * means before the session exists. What we can act on at that moment is the
 * merchant, the buyer's email and network, the amount, and the history of both.
 * Three outcomes:
 *
 *   allow  — create the session as normal
 *   verify — create it, but force 3-D Secure, which shifts liability for a
 *            stolen card back to the issuer
 *   block  — never create the session
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiskLevel } from '../business/taxonomy';
import { detectMisrepresentation, type MisrepresentationResult } from './misrepresentation';
import { findLinkedBusinesses } from './linkage';
import { scoreCheckout, type Decision, type Finding } from './rules';
import { extractCheckoutSignals, type CheckoutSignals } from './signals';
import {
  checkBlocklist,
  getRecentDescriptions,
  getVelocitySnapshot,
  recordFraudEvent,
} from './store';

export interface ScreenCheckoutInput {
  businessId: string;
  email?: string | null;
  ip?: string | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
}

export interface ScreenResult {
  decision: Decision;
  score: number;
  findings: Finding[];
  signals: CheckoutSignals;
  misrepresentation: MisrepresentationResult | null;
  /** Message safe to return to the caller. Deliberately vague. */
  buyerMessage?: string;
}

const BLOCK_MESSAGE =
  'This payment could not be processed. Please contact the merchant.';

/**
 * Screen a checkout attempt. Records the decision either way so the next
 * attempt has history to read.
 *
 * Fails open: if screening itself errors, the payment proceeds. A broken
 * fraud check must not become an outage.
 */
export async function screenCheckout(
  supabase: SupabaseClient,
  input: ScreenCheckoutInput
): Promise<ScreenResult> {
  const signals = extractCheckoutSignals(input);

  try {
    const { data: business } = await supabase
      .from('businesses')
      .select('id, merchant_id, category, risk_level, review_status')
      .eq('id', input.businessId)
      .maybeSingle();

    const merchantId = business?.merchant_id ?? null;

    const [blocklistHit, velocity, linkage, priorDescriptions] = await Promise.all([
      checkBlocklist(supabase, signals, merchantId),
      getVelocitySnapshot(supabase, signals),
      findLinkedBusinesses(supabase, input.businessId).catch(() => ({
        businessId: input.businessId,
        links: [],
        linkedBusinessIds: [],
        linkedToBlockedBusiness: false,
      })),
      getRecentDescriptions(supabase, input.businessId),
    ]);

    // Compare the declared category against what this merchant actually bills
    // for — this attempt's description plus recent history.
    const misrepresentation = detectMisrepresentation({
      declaredCategory: business?.category ?? null,
      texts: [signals.description, ...priorDescriptions],
    });

    const result = scoreCheckout({
      velocity,
      merchant: {
        riskLevel: (business?.risk_level as RiskLevel | null) ?? null,
        reviewStatus: business?.review_status ?? null,
        category: business?.category ?? null,
        linkedBusinessIds: linkage.linkedBusinessIds,
        linkedToBlockedBusiness: linkage.linkedToBlockedBusiness,
      },
      misrepresentation,
      email: signals.email,
      amount: signals.amount,
      blocklistAction: blocklistHit?.action ?? null,
      blocklistReason: blocklistHit?.reason ?? null,
    });

    await recordFraudEvent(supabase, {
      businessId: input.businessId,
      merchantId,
      kind: 'checkout_screen',
      decision: result.decision,
      score: result.score,
      signals,
      findings: result.findings,
    });

    return {
      ...result,
      signals,
      misrepresentation,
      buyerMessage: result.decision === 'block' ? BLOCK_MESSAGE : undefined,
    };
  } catch (error) {
    console.error('[Fraud] Screening failed, allowing payment:', error);
    return {
      decision: 'allow',
      score: 0,
      findings: [],
      signals,
      misrepresentation: null,
    };
  }
}
