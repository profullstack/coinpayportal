/**
 * Card decline codes, in plain English, sorted by what the merchant should do.
 *
 * Stripe hands back a `decline_code` (from the bank) or an error `code` (from
 * Stripe itself). Neither tells a merchant what to do next, and the raw message
 * ("Your card was declined.") hides the one fact that matters: whether trying
 * again will work. The action is what the "Who's behind" view groups by.
 *
 * Codes the bank uses to say a card is lost, stolen or fraudulent sit under
 * `do_not_chase`. Stripe's guidance is to tell the customer only that the card
 * was declined, so the customer-facing message for those never names the
 * reason; the merchant still sees it.
 */

export type DeclineAction = 'retry' | 'new_card' | 'unfinished' | 'call_bank' | 'do_not_chase';

export interface DeclineExplanation {
  action: DeclineAction;
  /** One sentence for the merchant: what the bank actually said. */
  reason: string;
}

const RETRY: Record<string, string> = {
  insufficient_funds: 'Not enough money in the account at the time.',
  processing_error: 'A processing error at the bank, not a problem with the card.',
  try_again_later: 'The bank asked for the payment to be tried again later.',
  issuer_not_available: 'The bank could not be reached.',
  reenter_transaction: 'The bank could not process it and asked for it to be re-entered.',
  approve_with_id: 'The bank could not authorise it this time.',
  card_velocity_exceeded: 'The card hit its spending or transaction limit.',
  withdrawal_count_limit_exceeded: 'The card hit its spending or transaction limit.',
};

const NEW_CARD: Record<string, string> = {
  expired_card: 'The card has expired.',
  incorrect_number: 'The card number was wrong.',
  invalid_number: 'The card number was wrong.',
  incorrect_cvc: 'The security code was wrong.',
  invalid_cvc: 'The security code was wrong.',
  invalid_expiry_month: 'The expiry date was wrong.',
  invalid_expiry_year: 'The expiry date was wrong.',
  incorrect_zip: 'The postcode did not match the card.',
  card_not_supported: 'The card does not support this kind of payment.',
  currency_not_supported: 'The card cannot be charged in this currency.',
  invalid_account: 'The card or its account is no longer valid.',
  new_account_information_available: 'The card has been replaced; the customer has new card details.',
  pin_try_exceeded: 'Too many wrong PIN attempts on the card.',
};

const UNFINISHED: Record<string, string> = {
  authentication_required: 'The bank wanted the customer to confirm it, and they did not.',
  payment_intent_authentication_failure: "The customer did not pass the bank's security check.",
  payment_intent_payment_attempt_expired: 'The customer started paying but never finished.',
  payment_intent_payment_attempt_failed: 'The payment attempt did not complete.',
  cashapp_customer_request_declined: 'The customer declined the payment in Cash App.',
  payment_method_customer_decline: 'The customer declined the payment themselves.',
  offline_pin_required: 'The bank wanted the card PIN.',
  online_or_offline_pin_required: 'The bank wanted the card PIN.',
};

const CALL_BANK: Record<string, string> = {
  generic_decline: 'The bank declined it without giving a reason.',
  do_not_honor: 'The bank declined it without giving a reason.',
  call_issuer: 'The bank wants the customer to call them.',
  transaction_not_allowed: 'The bank does not allow this kind of payment on the card.',
  not_permitted: 'The bank does not allow this kind of payment on the card.',
  service_not_allowed: 'The bank does not allow this kind of payment on the card.',
  no_action_taken: 'The bank declined it without giving a reason.',
  card_declined: 'The bank declined it without giving a reason.',
};

const DO_NOT_CHASE: Record<string, string> = {
  fraudulent: 'The bank suspects fraud.',
  lost_card: 'The card was reported lost.',
  stolen_card: 'The card was reported stolen.',
  pickup_card: 'The bank wants the card taken out of use (often lost or stolen).',
  restricted_card: 'The card is restricted (often lost or stolen).',
  merchant_blacklist: 'The card is on a block list.',
  security_violation: 'The bank flagged a security problem with the card.',
  stop_payment_order: 'The customer told their bank to stop paying you.',
  revocation_of_authorization: 'The customer withdrew permission to charge the card.',
  revocation_of_all_authorizations: 'The customer withdrew permission to charge the card.',
};

const TABLES: Array<[DeclineAction, Record<string, string>]> = [
  ['retry', RETRY],
  ['new_card', NEW_CARD],
  ['unfinished', UNFINISHED],
  ['call_bank', CALL_BANK],
  ['do_not_chase', DO_NOT_CHASE],
];

/**
 * Explain a card failure. `code` is the stored `failure_code`; `message` is the
 * raw Stripe message, used only when the code is unknown or missing.
 */
export function explainDecline(code: string | null | undefined, message?: string | null): DeclineExplanation {
  const key = (code || '').trim().toLowerCase();
  for (const [action, table] of TABLES) {
    if (key && table[key]) return { action, reason: table[key] };
  }
  const fallback = (message || '').trim();
  return {
    action: 'call_bank',
    reason: fallback && fallback !== 'Card payment failed' ? fallback : 'The bank declined it without giving a reason.',
  };
}
