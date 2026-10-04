/**
 * Remittance module — crypto in, local fiat out.
 *
 * The sender funds with stablecoin they already hold; the recipient is paid in
 * pesos or Philippine pesos through a partner's licensed local rail. Because we
 * never take the sender's dollars, the US money-transmission leg does not
 * exist for us — what remains is a payout integration running under the
 * partner's licence.
 *
 * Quotes are ranked on the local currency the recipient actually receives, not
 * on the fee a partner chooses to disclose, because on this market the FX
 * margin is usually the larger half of the cost.
 */

export * from './types';
export * from './router';
export * from './providers';
