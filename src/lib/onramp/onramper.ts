/**
 * Onramper — aggregator source.
 *
 * One credential reaches 30+ ramps (MoonPay among them), which is why this is
 * the first integration rather than a direct MoonPay one: a single signup gives
 * us a competitive set to rank, and no single provider outage can take fiat
 * entry down. It is also the aggregator already behind Exodus's own cross-chain
 * swaps, so we are competing with our counterpart's supplier, not their brand.
 *
 * Docs: https://docs.onramper.com
 *
 * IMPORTANT — response mapping is written defensively against the documented v3
 * shape but has never been run against a live key (we have none yet). Every
 * field read here is optional-guarded, and {@link parseQuote} drops anything it
 * cannot make sense of rather than emitting a quote with invented numbers. When
 * the first key lands, verify field names against a real response before
 * trusting the fee breakdown.
 */

import {
  OnrampAssets,
  OnrampPaymentMethod,
  OnrampProvider,
  OnrampQuoteParams,
  OnrampSession,
  OnrampSessionParams,
  RawOnrampQuote,
  ONRAMP_ASSET_MAP,
} from './types';

const ONRAMPER_API_URL = 'https://api.onramper.com';
const ONRAMPER_WIDGET_URL = 'https://buy.onramper.com';

/** Onramper's payment-method ids mapped onto ours. */
const PAYMENT_METHOD_FROM_ONRAMPER: Record<string, OnrampPaymentMethod> = {
  creditcard: 'card',
  debitcard: 'card',
  banktransfer: 'bank_transfer',
  sepabanktransfer: 'bank_transfer',
  fasterpayments: 'bank_transfer',
  ach: 'bank_transfer',
  // National instant rails, which Onramper exposes by name rather than as a
  // generic bank transfer. Without these each one falls through to 'other',
  // and a bank_transfer filter silently drops the only rail a local buyer
  // would reach for — the rail people actually use is never the generic one.
  interac: 'bank_transfer', // Canada
  interacetransfer: 'bank_transfer',
  spei: 'bank_transfer', // Mexico
  instapay: 'bank_transfer', // Philippines
  pesonet: 'bank_transfer',
  nip: 'bank_transfer', // Nigeria
  nigeriabanktransfer: 'bank_transfer',
  napas: 'bank_transfer', // Vietnam
  vietqr: 'bank_transfer',
  upi: 'bank_transfer', // India
  pixtransfer: 'pix', // Brazil
  // Wallets are not bank transfers, and in several of these markets they are
  // the dominant way to pay.
  gcash: 'ewallet', // Philippines
  maya: 'ewallet',
  paymaya: 'ewallet',
  momo: 'ewallet', // Vietnam
  zalopay: 'ewallet',
  vnpay: 'ewallet',
  opay: 'ewallet', // Nigeria
  palmpay: 'ewallet',
  applepay: 'apple_pay',
  googlepay: 'google_pay',
  pix: 'pix',
};

const PAYMENT_METHOD_TO_ONRAMPER: Partial<Record<OnrampPaymentMethod, string>> = {
  card: 'creditcard',
  bank_transfer: 'banktransfer',
  apple_pay: 'applepay',
  google_pay: 'googlepay',
  pix: 'pix',
};

function normalisePaymentMethod(id: unknown): OnrampPaymentMethod {
  if (typeof id !== 'string') return 'other';
  return PAYMENT_METHOD_FROM_ONRAMPER[id.toLowerCase()] ?? 'other';
}

/**
 * Onramper identifies an asset as ticker + network, e.g. `usdc_polygon`.
 */
function onramperAssetId(cryptoAsset: string): string {
  const mapping = ONRAMP_ASSET_MAP[cryptoAsset];
  if (!mapping) throw new Error(`Unsupported asset: ${cryptoAsset}`);
  // Native assets are addressed by bare ticker; tokens carry their network.
  const isToken = cryptoAsset.startsWith('USDT') || cryptoAsset.startsWith('USDC');
  return isToken ? `${mapping.asset}_${mapping.network}` : mapping.asset;
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

interface OnramperRawQuote {
  ramp?: string;
  payout?: number | string;
  rate?: number | string;
  networkFee?: number | string;
  transactionFee?: number | string;
  paymentMethod?: string;
  errors?: Array<{ message?: string; type?: string }>;
  [key: string]: unknown;
}

/**
 * Turn one Onramper entry into our shape, or null if it is not a usable quote.
 *
 * Onramper returns error entries inline in the same array as real quotes — a
 * ramp that cannot serve the country still gets a slot. Those must be dropped,
 * not rendered as a zero-payout option.
 */
export function parseQuote(
  entry: OnramperRawQuote,
  params: OnrampQuoteParams
): RawOnrampQuote | null {
  const payout = toFiniteNumber(entry.payout);
  if (payout === null || payout <= 0) return null;

  const ramp = typeof entry.ramp === 'string' && entry.ramp ? entry.ramp : 'unknown';

  const networkFee = toFiniteNumber(entry.networkFee) ?? 0;
  const transactionFee = toFiniteNumber(entry.transactionFee) ?? 0;

  const warnings: string[] = [];
  if (Array.isArray(entry.errors)) {
    for (const err of entry.errors) {
      if (err && typeof err.message === 'string') warnings.push(err.message);
    }
  }

  return {
    provider: ramp,
    providerLabel: ramp.charAt(0).toUpperCase() + ramp.slice(1),
    source: 'onramper',
    paymentMethod: normalisePaymentMethod(entry.paymentMethod),
    fiatCurrency: params.fiatCurrency.toUpperCase(),
    fiatAmount: params.fiatAmount,
    cryptoAsset: params.cryptoAsset,
    receiveAmount: payout,
    fees: {
      // Onramper reports the ramp's cut as transactionFee; it does not itemise
      // the card/ACH processing cost separately, so `payment` stays 0 rather
      // than double-counting it out of transactionFee.
      provider: transactionFee,
      network: networkFee,
      payment: 0,
      total: transactionFee + networkFee,
    },
    quotedRate: toFiniteNumber(entry.rate),
    etaSeconds: null,
    minFiatAmount: null,
    maxFiatAmount: null,
    warnings,
  };
}

export class OnramperProvider implements OnrampProvider {
  readonly id = 'onramper';
  readonly label = 'Onramper';

  private get apiKey(): string {
    return process.env.ONRAMPER_API_KEY || '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${ONRAMPER_API_URL}${path}`, {
      headers: { Authorization: this.apiKey },
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Onramper API error ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }

    return response.json() as Promise<T>;
  }

  async quote(params: OnrampQuoteParams, signal?: AbortSignal): Promise<RawOnrampQuote[]> {
    const fiat = params.fiatCurrency.toLowerCase();
    const crypto = onramperAssetId(params.cryptoAsset);

    const query = new URLSearchParams({ amount: String(params.fiatAmount) });
    if (params.country) query.set('country', params.country.toLowerCase());
    const pm = params.paymentMethod && PAYMENT_METHOD_TO_ONRAMPER[params.paymentMethod];
    if (pm) query.set('paymentMethod', pm);

    const body = await this.request<OnramperRawQuote[] | { message?: OnramperRawQuote[] }>(
      `/quotes/${fiat}/${crypto}?${query}`,
      signal
    );

    // v3 returns a bare array; some endpoints wrap in `message`. Accept both.
    const entries = Array.isArray(body) ? body : Array.isArray(body?.message) ? body.message : [];

    return entries
      .map((entry) => parseQuote(entry, params))
      .filter((quote): quote is RawOnrampQuote => quote !== null);
  }

  /**
   * Build a hosted-widget hand-off.
   *
   * This uses the documented widget URL rather than the checkout-intent API on
   * purpose: it is deterministic, needs no round trip, and cannot be broken by
   * a response shape we have not yet seen. The user completes KYC and payment
   * on Onramper's side, so the ramp stays merchant of record and the dispute
   * liability never touches our processing account.
   */
  async createSession(params: OnrampSessionParams): Promise<OnrampSession> {
    if (!this.isConfigured()) {
      throw new Error('Onramper is not configured');
    }

    const crypto = onramperAssetId(params.cryptoAsset);
    const query = new URLSearchParams({
      apiKey: this.apiKey,
      mode: 'buy',
      defaultFiat: params.fiatCurrency.toUpperCase(),
      defaultCrypto: crypto,
      defaultAmount: String(params.fiatAmount),
      onlyCryptos: crypto,
      // Deliver straight to the user's own address. We never take custody of
      // the purchased asset, which keeps this outside money transmission.
      wallets: `${crypto}:${params.walletAddress}`,
    });

    if (params.provider) query.set('onlyOnramps', params.provider);
    if (params.country) query.set('country', params.country.toUpperCase());
    if (params.redirectUrl) query.set('redirectURL', params.redirectUrl);
    if (params.externalId) query.set('partnerContext', params.externalId);
    const pm = params.paymentMethod && PAYMENT_METHOD_TO_ONRAMPER[params.paymentMethod];
    if (pm) query.set('onlyPaymentMethods', pm);

    return {
      source: this.id,
      provider: params.provider ?? 'best-available',
      url: `${ONRAMPER_WIDGET_URL}?${query}`,
      sessionId: null,
      expiresAt: null,
    };
  }

  async listAssets(signal?: AbortSignal): Promise<OnrampAssets> {
    const body = await this.request<{
      message?: { crypto?: Array<{ id?: string }>; fiat?: Array<{ id?: string }> };
    }>('/supported', signal);

    const ids = (list?: Array<{ id?: string }>): string[] =>
      (list ?? []).map((item) => item?.id).filter((id): id is string => typeof id === 'string');

    return {
      source: this.id,
      fiat: ids(body?.message?.fiat).map((id) => id.toUpperCase()),
      crypto: ids(body?.message?.crypto),
      paymentMethods: ['bank_transfer', 'card', 'apple_pay', 'google_pay', 'ewallet'],
    };
  }
}
