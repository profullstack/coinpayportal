/**
 * Fiat on-ramp module.
 *
 * Buys crypto with fiat by routing across several ramps and ranking them on the
 * amount that actually lands in the wallet, rather than on the fee percentage
 * each one chooses to advertise.
 *
 * We never touch the funds: the user pays the ramp, the ramp delivers to the
 * user's own address, and the ramp is merchant of record. That is what keeps
 * this outside money transmission — and it is what keeps chargebacks off our
 * processing account.
 */

export * from './types';
export * from './router';
export * from './providers';
