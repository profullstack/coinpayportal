/**
 * TransFi — covers four corridors from one API.
 *
 * SPEI for Mexico, GCash/Maya plus InstaPay/PESONet for the Philippines, and
 * MoMo/ZaloPay plus NAPAS 247 and VietQR for Vietnam — 53 countries with real
 * Southeast Asia depth. It is the only partner here serving US→PH and US→VN,
 * so without it both corridors have no live source at all.
 *
 * Docs: https://docs.transfi.com
 *
 * IMPORTANT — unlike the Bitso adapter, this cannot be grounded in a public
 * order book. The mapping is written defensively against the documented request
 * and response shape but has never been run against a real key. {@link parseQuote}
 * drops anything it cannot interpret rather than emitting a quote with invented
 * numbers, so the failure mode is a missing partner, not a wrong price. Verify
 * the fee fields against a live response before trusting them.
 */

import {
  Corridor,
  PayoutMethod,
  RawRemittanceQuote,
  RemittanceProvider,
  RemittanceQuoteParams,
  corridorFor,
} from './types';

const TRANSFI_API_URL = {
  sandbox: 'https://api-sandbox.transfi.com',
  production: 'https://api.transfi.com',
} as const;

/**
 * TransFi's `Basic` authorization header.
 *
 * Base64 of `apiKey:apiSecret`, where the key is the username half of the pair
 * and the secret is the password half. Both come from
 * displai.transfi.com → Settings → API Credentials, and sandbox and production
 * issue *separate* pairs.
 *
 * Exported so a test can assert the exact bytes. This adapter previously sent
 * `Authorization: Bearer <key>`, which TransFi does not accept under any
 * construction — it would have failed every request the moment a real key was
 * configured, and the resulting 401 is indistinguishable from an expired
 * credential, so the mistake would have survived a long time. The same class of
 * bug was in the Yellow Card adapter.
 */
export function authHeader(apiKey: string, apiSecret: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

/** Our payout methods mapped onto TransFi's, per corridor. */
const METHOD_TO_TRANSFI: Record<PayoutMethod, string> = {
  bank: 'bank_transfer',
  ewallet: 'wallet',
  cash_pickup: 'cash_pickup',
  debit_card: 'card',
};

const METHOD_FROM_TRANSFI: Record<string, PayoutMethod> = {
  bank_transfer: 'bank',
  bank: 'bank',
  wallet: 'ewallet',
  ewallet: 'ewallet',
  cash_pickup: 'cash_pickup',
  card: 'debit_card',
};

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

interface TransfiQuoteResponse {
  /** Documented responses wrap the body; tolerate a bare object too. */
  data?: TransfiQuoteBody;
  [key: string]: unknown;
}

interface TransfiQuoteBody {
  receiveAmount?: number | string;
  payoutAmount?: number | string;
  receiveCurrency?: string;
  exchangeRate?: number | string;
  fxRate?: number | string;
  totalFee?: number | string;
  processingFee?: number | string;
  networkFee?: number | string;
  payoutFee?: number | string;
  paymentMethod?: string;
  payoutMethod?: string;
  estimatedTimeSeconds?: number | string;
  [key: string]: unknown;
}

/**
 * Map a TransFi quote, or null when it carries no deliverable payout.
 *
 * Field names differ between the documented payout and collection endpoints
 * (`receiveAmount` vs `payoutAmount`, `exchangeRate` vs `fxRate`), so both are
 * accepted rather than guessing which one this deployment will see.
 */
export function parseQuote(
  body: TransfiQuoteResponse,
  params: RemittanceQuoteParams,
  corridor: Corridor,
  payoutCurrency: string
): RawRemittanceQuote | null {
  const data: TransfiQuoteBody = (body?.data ?? body) as TransfiQuoteBody;
  if (!data || typeof data !== 'object') return null;

  const receiveAmount =
    toFiniteNumber(data.receiveAmount) ?? toFiniteNumber(data.payoutAmount);
  if (receiveAmount === null || receiveAmount <= 0) return null;

  const processingFee = toFiniteNumber(data.processingFee) ?? 0;
  const networkFee = toFiniteNumber(data.networkFee) ?? 0;
  const payoutFee = toFiniteNumber(data.payoutFee) ?? 0;

  // Trust an explicit total over a breakdown that may be partial, but never
  // report a total smaller than the parts we were actually shown.
  const declaredTotal = toFiniteNumber(data.totalFee);
  const summed = processingFee + networkFee + payoutFee;
  const total = declaredTotal !== null ? Math.max(declaredTotal, summed) : summed;

  // Any part of the total the breakdown did not explain belongs somewhere
  // rather than nowhere.
  const unexplained = Math.max(0, total - summed);

  const method =
    METHOD_FROM_TRANSFI[(data.payoutMethod ?? data.paymentMethod ?? '').toLowerCase()] ??
    params.payoutMethod ??
    'bank';

  return {
    provider: 'transfi',
    providerLabel: 'TransFi',
    source: 'transfi',
    corridor,
    sendAsset: params.sendAsset,
    sendAmount: params.sendAmount,
    payoutCurrency: (data.receiveCurrency ?? payoutCurrency).toUpperCase(),
    payoutMethod: method,
    payoutNetwork: params.payoutNetwork ?? null,
    receiveAmount,
    fees: {
      provider: processingFee + unexplained,
      network: networkFee,
      payout: payoutFee,
      total,
    },
    quotedFxRate: toFiniteNumber(data.exchangeRate) ?? toFiniteNumber(data.fxRate),
    etaSeconds: toFiniteNumber(data.estimatedTimeSeconds),
    minSendAmountUsd: null,
    maxSendAmountUsd: null,
    warnings: [],
  };
}

export class TransfiProvider implements RemittanceProvider {
  readonly id = 'transfi';
  readonly label = 'TransFi';
  /**
   * TransFi is the breadth partner: one API, one key, many countries. It is the
   * only listed partner for most of Asia, Eastern Europe and South America, so
   * a single missing key takes those corridors down together — which is why
   * `/api/remittance/corridors` reports availability per corridor rather than
   * letting the page assume a region is served.
   *
   * Coverage below is claimed from TransFi's published payout countries and has
   * not been confirmed key-in-hand for every corridor. A corridor it turns out
   * not to serve fails as an empty quote list, not as a wrong price, so the
   * cost of listing one too many is a corridor that shows as unavailable.
   */
  readonly corridors: Corridor[] = [
    // Latin America
    'US-MX',
    'US-BR',
    'US-AR',
    'US-CO',
    'US-CL',
    'US-PE',
    // Southeast Asia
    'US-PH',
    'US-VN',
    'US-ID',
    'US-TH',
    'US-MY',
    'US-SG',
    // South Asia
    'US-IN',
    'US-PK',
    'US-BD',
    'US-LK',
    'US-NP',
    // Middle East and North Africa
    'US-AE',
    'US-SA',
    'US-TR',
    'US-EG',
    // Euro area
    'US-IE',
    'US-DE',
    'US-FR',
    'US-ES',
    'US-IT',
    'US-NL',
    'US-PT',
    // Eastern Europe
    'US-PL',
    'US-RO',
    'US-UA',
    'US-CZ',
    'US-HU',
    'US-BG',
    'US-RS',
    // Oceania
    'US-AU',
  ];

  private get apiKey(): string {
    return process.env.TRANSFI_API_KEY || '';
  }

  private get apiSecret(): string {
    return process.env.TRANSFI_API_SECRET || '';
  }

  /** Sandbox and production credentials are separate; default to production. */
  private get baseUrl(): string {
    return process.env.TRANSFI_ENVIRONMENT === 'sandbox'
      ? TRANSFI_API_URL.sandbox
      : TRANSFI_API_URL.production;
  }

  /**
   * Both halves are required.
   *
   * Basic auth needs the secret as well as the key, so a key on its own would
   * report all 37 of these corridors as available and then fail every quote
   * against them.
   */
  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.apiSecret.length > 0;
  }

  async quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]> {
    const spec = corridorFor(params.destinationCountry);
    // Also guard on our own corridor list: TransFi is listed for many
    // countries, but a direct caller must not reach the API for one it does
    // not serve.
    if (!spec || !this.corridors.includes(spec.corridor)) return [];

    const query = new URLSearchParams({
      sendCurrency: 'USD',
      sendAmount: String(params.sendAmount),
      receiveCurrency: spec.payoutCurrency,
      receiveCountry: spec.destinationCountry,
    });

    if (params.payoutMethod) {
      query.set('payoutMethod', METHOD_TO_TRANSFI[params.payoutMethod]);
    }
    if (params.payoutNetwork) {
      query.set('payoutNetwork', params.payoutNetwork);
    }

    // NOTE: the base URL and the auth scheme are verified against TransFi's
    // published docs; this *path* is not. Their current reference documents
    // `/v3/balance`, so `/v1/payouts/quote` may well be a stale version. It is
    // left as-is rather than guessed at: a wrong path fails as a 404 that this
    // adapter surfaces, whereas inventing one could silently hit a different
    // endpoint. Confirm it against a sandbox key before trusting a quote.
    const response = await fetch(`${this.baseUrl}/v1/payouts/quote?${query}`, {
      headers: { Authorization: authHeader(this.apiKey, this.apiSecret) },
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `TransFi API error ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      );
    }

    const quote = parseQuote(
      (await response.json()) as TransfiQuoteResponse,
      params,
      spec.corridor,
      spec.payoutCurrency
    );

    return quote ? [quote] : [];
  }
}
