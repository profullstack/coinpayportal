import { describe, expect, it, vi } from 'vitest';
import { handleSubscriptionPaymentConfirmed, SUBSCRIPTION_PRICES } from './service';

/**
 * Regression tests for F-1.3-13 (Critical, 2026-08-19 audit).
 *
 * `handleSubscriptionPaymentConfirmed` used to take `merchant_id` and `plan_id`
 * straight out of `payment.metadata`, and never compared the amount paid
 * against the plan's price. `POST /api/business-collection` stores a
 * caller-supplied `metadata` blob and a caller-supplied `amount` verbatim, so a
 * one-cent payment activated the $490/yr plan on any merchant UUID the payer
 * chose to name.
 */

const YEARLY_PRICE = SUBSCRIPTION_PRICES.professional.yearly;

type PaymentRow = {
  id: string;
  merchant_id: string | null;
  amount: number;
  currency: string;
  status: string;
  metadata: Record<string, unknown>;
};

const VICTIM = 'victim-merchant-uuid';
const ATTACKER = 'attacker-merchant-uuid';

function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'pay-1',
    merchant_id: ATTACKER,
    amount: YEARLY_PRICE,
    currency: 'USD',
    status: 'confirmed',
    metadata: {
      type: 'subscription_payment',
      plan_id: 'professional',
      billing_period: 'yearly',
      merchant_id: ATTACKER,
    },
    ...overrides,
  };
}

/**
 * Minimal Supabase double. Records every `merchants` update so a test can assert
 * both *whether* a plan was granted and *to whom*.
 */
function makeSupabase(payment: PaymentRow) {
  const merchantUpdates: Array<{ merchantId: unknown; values: Record<string, unknown> }> = [];

  const client = {
    from(table: string) {
      if (table === 'business_collection_payments') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: payment, error: null }),
            }),
          }),
        };
      }

      if (table === 'merchants') {
        return {
          update: (values: Record<string, unknown>) => ({
            eq: async (_col: string, merchantId: unknown) => {
              merchantUpdates.push({ merchantId, values });
              return { error: null };
            },
          }),
        };
      }

      if (table === 'subscription_history') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                contains: async () => ({ error: null }),
              }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { client: client as never, merchantUpdates };
}

describe('handleSubscriptionPaymentConfirmed', () => {
  it('activates the plan for a well-formed, fully-paid payment', async () => {
    const { client, merchantUpdates } = makeSupabase(paymentRow());

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(true);
    expect(merchantUpdates).toHaveLength(1);
    expect(merchantUpdates[0].merchantId).toBe(ATTACKER);
    expect(merchantUpdates[0].values.subscription_plan_id).toBe('professional');
    expect(merchantUpdates[0].values.subscription_status).toBe('active');
  });

  it('ignores metadata.merchant_id and credits the payment row owner', async () => {
    // The payer names a victim in metadata; the row belongs to the attacker.
    const { client, merchantUpdates } = makeSupabase(
      paymentRow({
        metadata: {
          type: 'subscription_payment',
          plan_id: 'professional',
          billing_period: 'yearly',
          merchant_id: VICTIM,
        },
      })
    );

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(true);
    expect(merchantUpdates).toHaveLength(1);
    expect(merchantUpdates[0].merchantId).toBe(ATTACKER);
    expect(merchantUpdates[0].merchantId).not.toBe(VICTIM);
  });

  it('refuses to activate a $490 plan for a $0.01 payment', async () => {
    const { client, merchantUpdates } = makeSupabase(paymentRow({ amount: 0.01 }));

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/underpayment/i);
    expect(merchantUpdates).toHaveLength(0);
  });

  it('refuses an unknown plan id', async () => {
    const { client, merchantUpdates } = makeSupabase(
      paymentRow({
        metadata: {
          type: 'subscription_payment',
          plan_id: 'enterprise-unlimited',
          billing_period: 'yearly',
          merchant_id: ATTACKER,
        },
      })
    );

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown plan/i);
    expect(merchantUpdates).toHaveLength(0);
  });

  it('refuses a monthly payment claiming the yearly plan', async () => {
    // Paying the $49 monthly price while tagging the row `yearly`.
    const { client, merchantUpdates } = makeSupabase(
      paymentRow({ amount: SUBSCRIPTION_PRICES.professional.monthly })
    );

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/underpayment/i);
    expect(merchantUpdates).toHaveLength(0);
  });

  it('refuses a payment denominated in something other than USD', async () => {
    // `amount` is the USD field; a non-USD row cannot be compared to the price.
    const { client, merchantUpdates } = makeSupabase(
      paymentRow({ currency: 'ETH', amount: YEARLY_PRICE })
    );

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not USD/i);
    expect(merchantUpdates).toHaveLength(0);
  });

  it('refuses a payment that has not confirmed', async () => {
    const { client, merchantUpdates } = makeSupabase(paymentRow({ status: 'pending' }));

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not confirmed/i);
    expect(merchantUpdates).toHaveLength(0);
  });

  it('accepts a confirmed payment still forwarding', async () => {
    // The money arrived; only the sweep to the collection wallet is in flight.
    const { client, merchantUpdates } = makeSupabase(paymentRow({ status: 'forwarding_failed' }));

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(true);
    expect(merchantUpdates).toHaveLength(1);
  });

  it('refuses a payment row with no merchant_id', async () => {
    const { client, merchantUpdates } = makeSupabase(paymentRow({ merchant_id: null }));

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(false);
    expect(merchantUpdates).toHaveLength(0);
  });

  it('ignores a payment that is not a subscription payment', async () => {
    const { client, merchantUpdates } = makeSupabase(
      paymentRow({ metadata: { type: 'invoice_payment' } })
    );

    const result = await handleSubscriptionPaymentConfirmed(client, 'pay-1');

    expect(result.success).toBe(false);
    expect(merchantUpdates).toHaveLength(0);
  });
});
