/**
 * Idempotently ensure CoinPay's single platform-level Stripe webhook
 * exists, points at the correct CoinPay URL, and is subscribed to every
 * event our handler at /api/stripe/webhook actually processes. Also
 * audits every other webhook on the platform Stripe account and reports
 * any that are NOT pointing at coinpayportal.com — those are the rogue
 * "merchant pasted their own URL" webhooks that intercept Stripe events
 * before CoinPay sees them (the d0rz incident).
 *
 * Stripe should ONLY know about coinpayportal.com. Per-merchant fan-out
 * happens AFTER CoinPay processes the event, by reading
 * businesses.webhook_url and POSTing a CoinPay-format payload signed
 * with the merchant's webhook_secret. Stripe must never know about
 * d0rz.com, ugig.net, or any other merchant URL.
 *
 * Usage:
 *   pnpm tsx scripts/ensure-platform-stripe-webhook.ts                  # audit only
 *   pnpm tsx scripts/ensure-platform-stripe-webhook.ts --apply          # create/update + delete rogue endpoints
 *   pnpm tsx scripts/ensure-platform-stripe-webhook.ts --apply --keep-rogue  # create/update only, leave rogues alone
 */

import Stripe from 'stripe';

const COINPAY_HOST = 'coinpayportal.com';
const COINPAY_WEBHOOK_URL = `https://${COINPAY_HOST}/api/stripe/webhook`;

// Every event the handler at src/app/api/stripe/webhook/route.ts switches on.
const REQUIRED_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.dispute.created',
  'payout.created',
  'payout.paid',
  'account.updated',
];

async function main() {
  const apply = process.argv.includes('--apply');
  const keepRogue = process.argv.includes('--keep-rogue');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('STRIPE_SECRET_KEY is not set');
    process.exit(1);
  }
  const stripe = new Stripe(stripeKey);

  console.log(`Mode: ${apply ? 'APPLY' : 'AUDIT (dry run)'}\n`);

  // List every webhook endpoint registered on the PLATFORM Stripe account.
  // (Connected accounts have their own per-account webhook lists; those are
  // legitimate and we don't touch them here.)
  const all = await stripe.webhookEndpoints.list({ limit: 100 });
  console.log(`Found ${all.data.length} platform webhook endpoints in Stripe.\n`);

  let canonical: Stripe.WebhookEndpoint | null = null;
  const rogues: Stripe.WebhookEndpoint[] = [];

  for (const ep of all.data) {
    let host = '';
    try { host = new URL(ep.url).host; } catch { /* ignore */ }
    if (host === COINPAY_HOST) {
      if (canonical) {
        // Multiple coinpay endpoints — keep the one with most events as canonical, mark others as duplicates.
        if ((ep.enabled_events || []).length > (canonical.enabled_events || []).length) {
          rogues.push(canonical);
          canonical = ep;
        } else {
          rogues.push(ep);
        }
      } else {
        canonical = ep;
      }
    } else {
      rogues.push(ep);
    }
  }

  // === Audit ===
  if (canonical) {
    console.log(`✓ Canonical CoinPay endpoint: ${canonical.id}`);
    console.log(`    url:    ${canonical.url}`);
    console.log(`    events: ${(canonical.enabled_events || []).join(', ') || '(none)'}`);
    const missing = REQUIRED_EVENTS.filter((e) => !(canonical!.enabled_events || []).includes(e as any));
    if (missing.length > 0) {
      console.log(`    ⚠ missing events: ${missing.join(', ')}`);
    }
  } else {
    console.log(`✗ No CoinPay platform endpoint exists. Stripe is not delivering events to CoinPay at all.`);
  }

  console.log('');
  if (rogues.length > 0) {
    console.log(`⚠ ${rogues.length} ROGUE endpoint(s) — Stripe is sending events somewhere other than CoinPay:`);
    for (const r of rogues) {
      console.log(`    ${r.id}  ${r.url}`);
      console.log(`      events: ${(r.enabled_events || []).slice(0, 6).join(', ')}${(r.enabled_events || []).length > 6 ? ', …' : ''}`);
      console.log(`      metadata: ${JSON.stringify(r.metadata || {})}`);
    }
  } else {
    console.log('✓ No rogue endpoints.');
  }

  if (!apply) {
    console.log('\n(audit only — re-run with --apply to fix)');
    return;
  }

  // === Apply ===
  console.log('\n--- Applying changes ---');

  // 1. Create or update the canonical CoinPay endpoint.
  let secret: string | undefined;
  if (!canonical) {
    console.log(`Creating canonical CoinPay endpoint at ${COINPAY_WEBHOOK_URL}…`);
    const created = await stripe.webhookEndpoints.create({
      url: COINPAY_WEBHOOK_URL,
      enabled_events: REQUIRED_EVENTS,
      connect: true, // also receive events from connected accounts
      metadata: { managed_by: 'coinpay-platform', role: 'ingestion' },
    });
    canonical = created;
    secret = created.secret || undefined;
    console.log(`  created: ${created.id}`);
    if (secret) {
      console.log(`\n  >>> Stripe signing secret (set as STRIPE_WEBHOOK_SECRET in prod env, ONE TIME ONLY) <<<`);
      console.log(`  ${secret}\n`);
    }
  } else {
    const needsUrlUpdate = canonical.url !== COINPAY_WEBHOOK_URL;
    const missing = REQUIRED_EVENTS.filter((e) => !(canonical!.enabled_events || []).includes(e as any));
    if (needsUrlUpdate || missing.length > 0) {
      console.log(`Updating canonical endpoint ${canonical.id}…`);
      const updated = await stripe.webhookEndpoints.update(canonical.id, {
        url: COINPAY_WEBHOOK_URL,
        enabled_events: REQUIRED_EVENTS,
      });
      canonical = updated;
      console.log(`  updated.`);
    } else {
      console.log(`Canonical endpoint already correct.`);
    }
  }

  // 2. Delete rogue endpoints (unless --keep-rogue).
  if (rogues.length > 0) {
    if (keepRogue) {
      console.log(`\n--keep-rogue: leaving ${rogues.length} rogue endpoint(s) in place.`);
    } else {
      console.log(`\nDeleting ${rogues.length} rogue endpoint(s)…`);
      for (const r of rogues) {
        try {
          await stripe.webhookEndpoints.del(r.id);
          console.log(`  deleted ${r.id}  ${r.url}`);
        } catch (err: any) {
          console.error(`  FAILED to delete ${r.id}: ${err.message}`);
        }
      }
    }
  }

  console.log('\nDone.');
  if (secret) {
    console.log('REMINDER: copy the signing secret above into prod env as STRIPE_WEBHOOK_SECRET and redeploy.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
