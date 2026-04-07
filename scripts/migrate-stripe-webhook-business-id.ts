/**
 * Migration: associate existing Stripe webhook endpoints with the correct
 * business UUID.
 *
 * Background: prior to this fix, webhook endpoints were created with
 * `metadata.business_id = stripe_account_id`, which meant a merchant with
 * multiple businesses sharing the same Stripe account couldn't tell whose
 * webhook was whose, and webhooks leaked across businesses in the UI.
 *
 * This script walks every row in `stripe_webhook_secrets` (which already
 * holds the merchant's stripe_account_id under `business_id`), looks up
 * the *real* business UUID via `stripe_accounts`, and patches both:
 *   1. the Stripe endpoint's metadata (business_id → UUID, stripe_account_id → acct)
 *   2. the secrets row's `business_id` column → UUID
 *
 * Idempotent: rows that already use a UUID are skipped.
 *
 * Run with: pnpm tsx scripts/migrate-stripe-webhook-business-id.ts [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const DRY_RUN = process.argv.includes('--dry-run');

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey || !stripeKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STRIPE_SECRET_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const stripe = new Stripe(stripeKey);

  // Build acct → business_id map from stripe_accounts
  const { data: accounts, error: acctErr } = await supabase
    .from('stripe_accounts')
    .select('business_id, stripe_account_id');
  if (acctErr) {
    console.error('Failed to load stripe_accounts:', acctErr);
    process.exit(1);
  }

  const acctToBusiness = new Map<string, string[]>();
  for (const a of accounts || []) {
    const list = acctToBusiness.get(a.stripe_account_id) || [];
    list.push(a.business_id);
    acctToBusiness.set(a.stripe_account_id, list);
  }

  const { data: secrets, error: secErr } = await supabase
    .from('stripe_webhook_secrets')
    .select('endpoint_id, business_id');
  if (secErr) {
    console.error('Failed to load stripe_webhook_secrets:', secErr);
    process.exit(1);
  }

  let patched = 0;
  let skipped = 0;
  let ambiguous = 0;
  let notFound = 0;

  for (const row of secrets || []) {
    if (isUuid(row.business_id)) {
      skipped++;
      continue;
    }

    // row.business_id is actually a stripe_account_id from the buggy code path
    const candidates = acctToBusiness.get(row.business_id) || [];
    if (candidates.length === 0) {
      console.warn(`[skip] endpoint ${row.endpoint_id}: no business found for stripe_account_id=${row.business_id}`);
      notFound++;
      continue;
    }
    if (candidates.length > 1) {
      console.warn(
        `[ambiguous] endpoint ${row.endpoint_id}: stripe_account_id=${row.business_id} maps to ${candidates.length} businesses; needs manual review`
      );
      ambiguous++;
      continue;
    }
    const businessId = candidates[0];

    console.log(`[patch] endpoint=${row.endpoint_id} stripe_acct=${row.business_id} → business=${businessId}`);
    if (DRY_RUN) continue;

    // Patch Stripe endpoint metadata. Try platform first, then connected account.
    try {
      await stripe.webhookEndpoints.update(row.endpoint_id, {
        metadata: { business_id: businessId, stripe_account_id: row.business_id },
      });
    } catch {
      try {
        await stripe.webhookEndpoints.update(
          row.endpoint_id,
          { metadata: { business_id: businessId, stripe_account_id: row.business_id } },
          { stripeAccount: row.business_id }
        );
      } catch (e: any) {
        console.error(`  failed to update Stripe endpoint ${row.endpoint_id}: ${e.message}`);
        continue;
      }
    }

    const { error: upErr } = await supabase
      .from('stripe_webhook_secrets')
      .update({ business_id: businessId })
      .eq('endpoint_id', row.endpoint_id);
    if (upErr) {
      console.error(`  failed to update secrets row for ${row.endpoint_id}: ${upErr.message}`);
      continue;
    }
    patched++;
  }

  console.log('\n=== Summary ===');
  console.log(`patched:    ${patched}`);
  console.log(`skipped:    ${skipped} (already UUID)`);
  console.log(`ambiguous:  ${ambiguous} (needs manual review)`);
  console.log(`not found:  ${notFound}`);
  if (DRY_RUN) console.log('(dry run — no changes written)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
