import { NextResponse } from 'next/server';

/**
 * The cloud bank browser is switched off for good (2026-10-29).
 *
 * A signed-in bank session can move money, so CoinPay no longer drives a bank
 * login for anyone, keeps one alive, or stores its cookies. Bank data comes
 * only from read-only Plaid (transactions, liabilities), read-only SimpleFIN,
 * and statement PDFs the merchant uploads. This is a constant, not an env
 * flag, so no deploy setting can turn it back on.
 */
export const CLOUD_BANK_BROWSER_ENABLED = false;

export const CLOUD_BANK_BROWSER_OFF_MESSAGE =
  'The cloud bank browser is turned off. CoinPay only reads bank data through read-only Plaid and SimpleFIN, or statements you upload.';

/** 410 for every cloud bank browser route that would sign in, fetch or keep a session alive. */
export function cloudBankBrowserGone(): NextResponse {
  return NextResponse.json({ success: false, error: CLOUD_BANK_BROWSER_OFF_MESSAGE, code: 'cloud_bank_browser_disabled' }, { status: 410 });
}
