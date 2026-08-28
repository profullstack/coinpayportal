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

import {
  Corridor,
  PayoutMethod,
  RawRemittanceQuote,
  RemittanceProvider,
  RemittanceQuoteParams,
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

export class YellowCardProvider implements RemittanceProvider {
  readonly id = 'yellowcard';
  readonly label = 'Yellow Card';
  readonly corridors: Corridor[] = ['US-NG'];

  private get apiKey(): string {
    return process.env.YELLOWCARD_API_KEY || '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]> {
    const query = new URLSearchParams({
      currency: 'NGN',
      country: 'NG',
      amount: String(params.sendAmount),
      amountType: 'crypto',
    });

    if (params.payoutNetwork) {
      query.set('channel', params.payoutNetwork);
    }

    const response = await fetch(`${YELLOWCARD_API_URL}/business/quotes?${query}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
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
