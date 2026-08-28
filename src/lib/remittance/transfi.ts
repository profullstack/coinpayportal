/**
 * TransFi — covers both corridors from one API.
 *
 * SPEI for Mexico, GCash/Maya plus InstaPay/PESONet for the Philippines, across
 * 53 countries with real Southeast Asia depth. It is the only partner here that
 * serves US→PH, so without it that corridor has no live source at all.
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

const TRANSFI_API_URL = 'https://api.transfi.com';

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
  readonly corridors: Corridor[] = ['US-MX', 'US-PH'];

  private get apiKey(): string {
    return process.env.TRANSFI_API_KEY || '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]> {
    const spec = corridorFor(params.destinationCountry);
    if (!spec) return [];

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

    const response = await fetch(`${TRANSFI_API_URL}/v1/payouts/quote?${query}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
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
