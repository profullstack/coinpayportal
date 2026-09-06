/**
 * Bitnob — African payout partner, six corridors from one API.
 *
 * Funds a payout from USDT or USDC and delivers local currency over the rail
 * the recipient actually uses: NIP in Nigeria, M-Pesa in Kenya and Tanzania,
 * MTN MoMo in Ghana and Uganda, PayShap or EFT in South Africa. The recipient
 * never touches crypto, which is the same structural move the rest of this
 * module makes — the licensed party stays the licensed party.
 *
 * Chosen over {@link ./yellowcard} as the first African partner for one
 * practical reason: sandbox keys are self-serve, so this adapter can be
 * verified against a real response without a partnership call first. Yellow
 * Card remains registered as a second partner for Nigeria; the router ranks
 * them on delivered NGN, so whichever actually pays more wins.
 *
 * VERIFIED: the authentication scheme below is taken from Bitnob's published
 * spec — `CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD` joined with colons, HMAC-SHA256
 * keyed with the client secret, hex-encoded, sent across four `X-Auth-*`
 * headers.
 *
 * NOT VERIFIED: the quote request and response field names. They are written
 * against the documented shape but have not been run against a live key.
 * {@link parseQuote} drops anything it cannot interpret rather than emitting a
 * quote with invented numbers, so a bad mapping surfaces as a missing partner
 * and never as a wrong price. When a sandbox key arrives, the only two places
 * that should need correcting are {@link buildQuoteBody} and
 * {@link parseQuote}.
 */

import { createHmac, randomBytes } from 'node:crypto';

import {
  Corridor,
  CORRIDORS,
  PayoutMethod,
  RawRemittanceQuote,
  RemittanceProvider,
  RemittanceQuoteParams,
  corridorFor,
} from './types';

const BITNOB_API_URL = 'https://api.bitnob.com';
const QUOTE_PATH = '/api/payouts/quotes';

/** Corridors Bitnob is licensed to pay into, and the currency each lands in. */
const BITNOB_CORRIDORS: Corridor[] = ['US-NG', 'US-KE', 'US-GH', 'US-ZA', 'US-UG', 'US-TZ'];

const METHOD_FROM_BITNOB: Record<string, PayoutMethod> = {
  bank: 'bank',
  bank_transfer: 'bank',
  nip: 'bank',
  mobile_money: 'ewallet',
  momo: 'ewallet',
  wallet: 'ewallet',
};

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

interface BitnobQuoteResponse {
  data?: BitnobQuoteBody;
  [key: string]: unknown;
}

interface BitnobQuoteBody {
  /** Local currency the recipient receives. Named inconsistently across docs. */
  settlementAmount?: number | string;
  receiveAmount?: number | string;
  localAmount?: number | string;
  /** Local currency per 1 USD. */
  rate?: number | string;
  exchangeRate?: number | string;
  currency?: string;
  settlementCurrency?: string;
  fee?: number | string;
  totalFee?: number | string;
  networkFee?: number | string;
  channel?: string;
  [key: string]: unknown;
}

/**
 * The canonical string Bitnob signs, and the four headers that carry it.
 *
 * Exported so a test can assert the exact bytes rather than only that some
 * signature was produced — an auth scheme that is subtly wrong fails as a 401
 * at the partner, which the router would report as a partner outage rather
 * than as our bug.
 */
export function signRequest(
  clientId: string,
  clientSecret: string,
  payload: string,
  nowSeconds: number,
  nonce: string
): Record<string, string> {
  const message = `${clientId}:${nowSeconds}:${nonce}:${payload}`;
  const signature = createHmac('sha256', clientSecret).update(message).digest('hex');

  return {
    'X-Auth-Client': clientId,
    'X-Auth-Timestamp': String(nowSeconds),
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': signature,
  };
}

/**
 * The quote request body.
 *
 * Isolated so that correcting it against a live sandbox response is a one-
 * function change. The send side is expressed in USD rather than in the
 * stablecoin ticker: Bitnob prices the payout leg, and the sender's crypto
 * spot is applied by the router, not here.
 */
export function buildQuoteBody(params: RemittanceQuoteParams, payoutCurrency: string) {
  return {
    source: { currency: 'USD', amount: params.sendAmount },
    destination: {
      country: params.destinationCountry.toUpperCase(),
      currency: payoutCurrency,
      ...(params.payoutNetwork ? { channel: params.payoutNetwork } : {}),
    },
  };
}

/**
 * Map a Bitnob quote, or null when it carries no deliverable payout.
 *
 * Field names differ between the payouts and settlement docs, so every
 * plausible spelling is accepted rather than guessing which one this account
 * will be served.
 */
export function parseQuote(
  body: BitnobQuoteResponse,
  params: RemittanceQuoteParams,
  corridor: Corridor,
  payoutCurrency: string
): RawRemittanceQuote | null {
  const data: BitnobQuoteBody = (body?.data ?? body) as BitnobQuoteBody;
  if (!data || typeof data !== 'object') return null;

  const receiveAmount =
    toFiniteNumber(data.settlementAmount) ??
    toFiniteNumber(data.receiveAmount) ??
    toFiniteNumber(data.localAmount);
  if (receiveAmount === null || receiveAmount <= 0) return null;

  const providerFee = toFiniteNumber(data.fee) ?? toFiniteNumber(data.totalFee) ?? 0;
  const networkFee = toFiniteNumber(data.networkFee) ?? 0;

  return {
    provider: 'bitnob',
    providerLabel: 'Bitnob',
    source: 'bitnob',
    corridor,
    sendAsset: params.sendAsset,
    sendAmount: params.sendAmount,
    payoutCurrency: (data.settlementCurrency ?? data.currency ?? payoutCurrency).toUpperCase(),
    payoutMethod:
      METHOD_FROM_BITNOB[(data.channel ?? '').toLowerCase()] ?? params.payoutMethod ?? 'bank',
    payoutNetwork: params.payoutNetwork ?? null,
    receiveAmount,
    fees: {
      provider: providerFee,
      network: networkFee,
      payout: 0,
      total: providerFee + networkFee,
    },
    quotedFxRate: toFiniteNumber(data.rate) ?? toFiniteNumber(data.exchangeRate),
    // Mobile money and NIP both settle in seconds; Bitnob's own SLA is 98% of
    // payouts under five minutes, so this is the honest middle rather than the
    // best case.
    etaSeconds: 120,
    minSendAmountUsd: null,
    maxSendAmountUsd: null,
    warnings: [],
  };
}

export class BitnobProvider implements RemittanceProvider {
  readonly id = 'bitnob';
  readonly label = 'Bitnob';
  readonly corridors: Corridor[] = BITNOB_CORRIDORS;

  private get clientId(): string {
    return process.env.BITNOB_CLIENT_ID || '';
  }

  private get clientSecret(): string {
    return process.env.BITNOB_CLIENT_SECRET || '';
  }

  isConfigured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  async quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]> {
    const spec = corridorFor(params.destinationCountry);
    // Guard on our own corridor list as well as on the country being known.
    // The router already filters by `servesCorridor`, but a direct caller must
    // not be able to make us quote a country this partner cannot pay into.
    if (!spec || !this.corridors.includes(spec.corridor)) return [];

    const payoutCurrency = CORRIDORS[spec.corridor].payoutCurrency;
    const payload = JSON.stringify(buildQuoteBody(params, payoutCurrency));
    const headers = signRequest(
      this.clientId,
      this.clientSecret,
      payload,
      Math.floor(Date.now() / 1000),
      randomBytes(16).toString('hex')
    );

    const response = await fetch(`${BITNOB_API_URL}${QUOTE_PATH}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: payload,
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Bitnob API error ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      );
    }

    const quote = parseQuote(
      (await response.json()) as BitnobQuoteResponse,
      params,
      spec.corridor,
      payoutCurrency
    );
    return quote ? [quote] : [];
  }
}
