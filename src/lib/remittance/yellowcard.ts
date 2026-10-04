/**
 * Yellow Card — US→NG payout partner.
 *
 * Purpose-built for stablecoin into African local currency, covering 20+
 * countries with Nigeria as its largest market. Payouts land over NIP (NIBSS
 * Instant Payment), which reaches every Nigerian bank and the fintech wallets
 * built on top of it — OPay, PalmPay and Kuda are NIP endpoints rather than
 * separate rails.
 *
 * Docs: https://docs.yellowcard.engineering
 *
 * IMPORTANT — written against the documented request and response shape but
 * never run against a real key. {@link parseQuote} drops anything it cannot
 * interpret rather than emitting a quote with invented numbers, so a bad
 * mapping surfaces as a missing partner and not as a wrong price. Verify the
 * fee fields against a live response before trusting them.
 *
 * A note specific to this corridor: the naira has an official rate and a
 * parallel-market rate that sit a few percent apart. Yellow Card prices off the
 * market it actually trades in, which is not the rate our FX reference quotes,
 * so the router flags the resulting margin rather than presenting it as
 * settled fact. See `fxReferenceContested` in `types.ts`.
 */

import { createHmac } from 'node:crypto';

import {
  Corridor,
  PayoutMethod,
  RawRemittanceQuote,
  RemittanceProvider,
  RemittanceQuoteParams,
  corridorFor,
} from './types';

const YELLOWCARD_API_URL = 'https://api.yellowcard.io';

const METHOD_FROM_YELLOWCARD: Record<string, PayoutMethod> = {
  bank: 'bank',
  bank_transfer: 'bank',
  nip: 'bank',
  mobile_money: 'ewallet',
  wallet: 'ewallet',
};

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

interface YellowCardQuoteResponse {
  data?: YellowCardQuoteBody;
  [key: string]: unknown;
}

interface YellowCardQuoteBody {
  /** Local currency the recipient receives. */
  localAmount?: number | string;
  receiveAmount?: number | string;
  currency?: string;
  /** Local currency per 1 USD. */
  rate?: number | string;
  fee?: number | string;
  totalFee?: number | string;
  networkFee?: number | string;
  channel?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

/**
 * Map a Yellow Card quote, or null when it carries no deliverable payout.
 *
 * Field names differ between their documented quote and payment endpoints
 * (`localAmount` vs `receiveAmount`, `fee` vs `totalFee`), so both are accepted
 * rather than guessing which this deployment will see.
 */
export function parseQuote(
  body: YellowCardQuoteResponse,
  params: RemittanceQuoteParams
): RawRemittanceQuote | null {
  const data: YellowCardQuoteBody = (body?.data ?? body) as YellowCardQuoteBody;
  if (!data || typeof data !== 'object') return null;

  const receiveAmount = toFiniteNumber(data.localAmount) ?? toFiniteNumber(data.receiveAmount);
  if (receiveAmount === null || receiveAmount <= 0) return null;

  const providerFee = toFiniteNumber(data.fee) ?? toFiniteNumber(data.totalFee) ?? 0;
  const networkFee = toFiniteNumber(data.networkFee) ?? 0;

  return {
    provider: 'yellowcard',
    providerLabel: 'Yellow Card',
    source: 'yellowcard',
    corridor: 'US-NG' as Corridor,
    sendAsset: params.sendAsset,
    sendAmount: params.sendAmount,
    payoutCurrency: (data.currency ?? 'NGN').toUpperCase(),
    payoutMethod:
      METHOD_FROM_YELLOWCARD[(data.channel ?? '').toLowerCase()] ?? params.payoutMethod ?? 'bank',
    payoutNetwork: params.payoutNetwork ?? 'nip',
    receiveAmount,
    fees: {
      provider: providerFee,
      network: networkFee,
      payout: 0,
      total: providerFee + networkFee,
    },
    quotedFxRate: toFiniteNumber(data.rate),
    // NIP settles in seconds.
    etaSeconds: 120,
    minSendAmountUsd: null,
    maxSendAmountUsd: null,
    warnings: [],
  };
}

/**
 * Yellow Card's `YcHmacV1` authorization header.
 *
 * VERIFIED from their published spec: authenticated requests carry an
 * `X-YC-Timestamp` header holding an ISO8601 timestamp, and an `Authorization`
 * header of the form `YcHmacV1 {apikey}:{signature}` where the signature is an
 * HMAC over the request, keyed with the secret paired to that API key.
 *
 * NOT VERIFIED: the exact canonical string being signed. Yellow Card's docs
 * return 403 to automated fetches, so the concatenation order below —
 * timestamp, method, path, then a SHA-256 of the body — is the conventional
 * construction rather than one read off their page. It is isolated here so
 * that correcting it is a one-function change once a partner key and the
 * documentation are in hand.
 *
 * The previous implementation sent `Authorization: Bearer <key>`, which their
 * API does not accept under any construction, so this is strictly closer even
 * while the canonical string is unconfirmed. A wrong signature fails as a 401,
 * which the router already treats as a partner that could not quote — it can
 * never surface as a wrong price.
 */
export function signRequest(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  timestamp: string,
  body = ''
): Record<string, string> {
  const bodyHash = createHmac('sha256', apiSecret).update(body).digest('base64');
  const signature = createHmac('sha256', apiSecret)
    .update(`${timestamp}${method.toUpperCase()}${path}${body ? bodyHash : ''}`)
    .digest('base64');

  return {
    Authorization: `YcHmacV1 ${apiKey}:${signature}`,
    'X-YC-Timestamp': timestamp,
  };
}

export class YellowCardProvider implements RemittanceProvider {
  readonly id = 'yellowcard';
  readonly label = 'Yellow Card';
  readonly corridors: Corridor[] = ['US-NG'];

  private get apiKey(): string {
    return process.env.YELLOWCARD_API_KEY || '';
  }

  private get apiSecret(): string {
    return process.env.YELLOWCARD_API_SECRET || '';
  }

  /**
   * Both halves are required. The signing scheme needs the secret, so a key on
   * its own cannot authenticate and would report this corridor as available
   * while failing every quote.
   */
  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.apiSecret.length > 0;
  }

  async quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]> {
    // Guard on our own corridor list as well as on the country being known.
    // The router filters by `servesCorridor` before calling, but a direct
    // caller must not be able to make this partner quote a country it cannot
    // pay into — with a wide corridor map that would otherwise return a quote
    // labelled with the wrong currency.
    const spec = corridorFor(params.destinationCountry);
    if (!spec || !this.corridors.includes(spec.corridor)) return [];

    const query = new URLSearchParams({
      currency: 'NGN',
      country: 'NG',
      amount: String(params.sendAmount),
      amountType: 'crypto',
    });

    if (params.payoutNetwork) {
      query.set('channel', params.payoutNetwork);
    }

    const path = `/business/quotes?${query}`;
    const response = await fetch(`${YELLOWCARD_API_URL}${path}`, {
      headers: signRequest(
        this.apiKey,
        this.apiSecret,
        'GET',
        path,
        new Date().toISOString()
      ),
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Yellow Card API error ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      );
    }

    const quote = parseQuote((await response.json()) as YellowCardQuoteResponse, params);
    return quote ? [quote] : [];
  }
}
