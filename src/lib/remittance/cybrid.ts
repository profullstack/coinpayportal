/**
 * Cybrid — US→CA payout partner.
 *
 * Moves between stablecoin and Canadian fiat rails through one API, covering
 * both EFT and Interac e-Transfer. Interac is the rail that matters: it is the
 * default way Canadians move money and settles in minutes below CAD 10,000.
 *
 * Docs: https://cybrid.xyz
 *
 * A note on why this corridor reads differently from the others. US→CA is a
 * developed-market route where the incumbents are already efficient — Wise
 * moves USD→CAD for well under 1% all-in. We are at parity here, not an order
 * of magnitude cheaper, and `matureCorridor` on the corridor spec exists so the
 * UI does not dress that parity up as a saving. What this corridor buys is
 * settling straight from stablecoin in minutes, not a lower price.
 *
 * IMPORTANT — written against the documented shape, never run against a real
 * key. {@link parseQuote} drops anything it cannot interpret rather than
 * emitting a quote with invented numbers.
 */

import {
  Corridor,
  RawRemittanceQuote,
  RemittanceProvider,
  RemittanceQuoteParams,
} from './types';

const CYBRID_API_URL = 'https://bank.production.cybrid.app';

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

interface CybridQuoteResponse {
  /** Cybrid denominates in the currency's base unit — cents for CAD. */
  receive_amount?: number | string;
  deliver_amount?: number | string;
  fee?: number | string;
  network_fee?: number | string;
  asset?: string;
  rate?: number | string;
  [key: string]: unknown;
}

/**
 * Map a Cybrid quote, or null when it carries no deliverable payout.
 *
 * Amounts arrive in the asset's base unit — cents for CAD — so they are scaled
 * before use. Getting that wrong by a factor of 100 would be an unusually
 * expensive bug, which is why it is done here and covered by a test.
 */
export function parseQuote(
  body: CybridQuoteResponse,
  params: RemittanceQuoteParams
): RawRemittanceQuote | null {
  if (!body || typeof body !== 'object') return null;

  const baseUnits = toFiniteNumber(body.receive_amount) ?? toFiniteNumber(body.deliver_amount);
  if (baseUnits === null || baseUnits <= 0) return null;

  const receiveAmount = baseUnits / 100;

  const providerFee = (toFiniteNumber(body.fee) ?? 0) / 100;
  const networkFee = (toFiniteNumber(body.network_fee) ?? 0) / 100;

  return {
    provider: 'cybrid',
    providerLabel: 'Cybrid',
    source: 'cybrid',
    corridor: 'US-CA' as Corridor,
    sendAsset: params.sendAsset,
    sendAmount: params.sendAmount,
    payoutCurrency: (body.asset ?? 'CAD').toUpperCase(),
    payoutMethod: 'bank',
    payoutNetwork: params.payoutNetwork ?? 'interac',
    receiveAmount,
    fees: {
      provider: providerFee,
      network: networkFee,
      payout: 0,
      total: providerFee + networkFee,
    },
    quotedFxRate: toFiniteNumber(body.rate),
    // Interac settles in minutes under CAD 10,000.
    etaSeconds: 600,
    minSendAmountUsd: null,
    maxSendAmountUsd: null,
    warnings: [],
  };
}

export class CybridProvider implements RemittanceProvider {
  readonly id = 'cybrid';
  readonly label = 'Cybrid';
  readonly corridors: Corridor[] = ['US-CA'];

  private get apiKey(): string {
    return process.env.CYBRID_API_KEY || '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]> {
    const response = await fetch(`${CYBRID_API_URL}/api/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_type: 'crypto_transfer',
        side: 'sell',
        symbol: `${params.sendAsset.split('_')[0]}-CAD`,
        // Sent in base units, matching how they come back.
        deliver_amount: Math.round(params.sendAmount * 100),
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Cybrid API error ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      );
    }

    const quote = parseQuote((await response.json()) as CybridQuoteResponse, params);
    return quote ? [quote] : [];
  }
}
