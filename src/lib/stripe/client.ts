import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

/**
 * Get Stripe client singleton
 */
export function getStripeClient(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetStripeClient(): void {
  stripeInstance = null;
}
