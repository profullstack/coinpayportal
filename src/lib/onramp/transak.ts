/**
 * Transak — second source.
 *
 * Exists so we are never single-vendor. An aggregator is still one API key and
 * one company: if Onramper is down, or drops a corridor, or prices badly for a
 * given country, a second independent source keeps fiat entry alive and keeps
 * the ranking honest by having something to rank against.
 *
 * Docs: https://docs.transak.com
 *
 * Transak is unusual and useful here: its quote returns both `conversionPrice`
 * and `marketConversionPrice`, so it discloses its own spread. Most ramps do
 * not. We still let the router derive the spread from spot for every source
 * uniformly, but see {@link parseQuote} for the cross-check.
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

/**
 * Transak runs staging on separate hosts, and a staging key is what a new
 * partner account issues first — production is unlocked only after KYB. Sending
 * a staging key to the production host fails in a way that reads like a bad
 * credential, so the environment is switchable rather than hardcoded.
 */
const TRANSAK_HOSTS = {
  production: { api: 'https://api.transak.com', widget: 'https://global.transak.com' },
  staging: { api: 'https://api-stg.transak.com', widget: 'https://global-stg.transak.com' },
} as const;

export type TransakEnvironment = keyof typeof TRANSAK_HOSTS;

/** Defaults to production; set TRANSAK_ENVIRONMENT=staging while testing. */
export function transakHosts(): (typeof TRANSAK_HOSTS)[TransakEnvironment] {
  return process.env.TRANSAK_ENVIRONMENT === 'staging'
    ? TRANSAK_HOSTS.staging
    : TRANSAK_HOSTS.production;
}

/** Our asset symbols to Transak's (cryptoCurrencyCode, network) pair. */
const TRANSAK_NETWORK: Record<string, string> = {
  bitcoin: 'mainnet',
  bitcoincash: 'mainnet',
  ethereum: 'ethereum',
  polygon: 'polygon',
  solana: 'solana',
  bsc: 'bsc',
  dogecoin: 'mainnet',
  ripple: 'mainnet',
  cardano: 'mainnet',
};

const PAYMENT_METHOD_FROM_TRANSAK: Record<string, OnrampPaymentMethod> = {
  credit_debit_card: 'card',
  apple_pay: 'apple_pay',
  google_pay: 'google_pay',
  sepa_bank_transfer: 'bank_transfer',
  gbp_bank_transfer: 'bank_transfer',
  pm_ach_bank_transfer: 'bank_transfer',
  pm_us_wire_bank_transfer: 'bank_transfer',
  pm_pix: 'pix',
  pm_gcash: 'ewallet',
  pm_open_banking: 'bank_transfer',
  inr_bank_transfer: 'bank_transfer',
  pm_upi: 'bank_transfer',
  pm_interac: 'bank_transfer',
};

const PAYMENT_METHOD_TO_TRANSAK: Partial<Record<OnrampPaymentMethod, string>> = {
  card: 'credit_debit_card',
  bank_transfer: 'pm_ach_bank_transfer',
  apple_pay: 'apple_pay',
  google_pay: 'google_pay',
  pix: 'pm_pix',
};

function transakAsset(cryptoAsset: string): { code: string; network: string } {
  const mapping = ONRAMP_ASSET_MAP[cryptoAsset];
  if (!mapping) throw new Error(`Unsupported asset: ${cryptoAsset}`);
  return {
    code: mapping.asset.toUpperCase(),
    network: TRANSAK_NETWORK[mapping.network] ?? mapping.network,
  };
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

interface TransakQuoteResponse {
  response?: {
    cryptoAmount?: number | string;
    fiatAmount?: number | string;
    totalFee?: number | string;
    conversionPrice?: number | string;
    marketConversionPrice?: number | string;
    paymentMethod?: string;
    feeBreakdown?: Array<{ name?: string; value?: number | string; id?: string }>;
  };
}

/**
 * Map a Transak quote, or null when it carries no deliverable amount.
 *
 * The fee breakdown separates Transak's own cut from the card/bank processing
 * cost, so unlike Onramper we can populate `payment` honestly instead of
 * folding everything into `provider`.
 */
export function parseQuote(
  body: TransakQuoteResponse,
  params: OnrampQuoteParams
): RawOnrampQuote | null {
  const response = body?.response;
  if (!response) return null;

  const cryptoAmount = toFiniteNumber(response.cryptoAmount);
  if (cryptoAmount === null || cryptoAmount <= 0) return null;

  const totalFee = toFiniteNumber(response.totalFee) ?? 0;

  let providerFee = 0;
  let paymentFee = 0;
  let networkFee = 0;

  for (const item of response.feeBreakdown ?? []) {
    const value = toFiniteNumber(item?.value) ?? 0;
    const id = (item?.id ?? item?.name ?? '').toLowerCase();
    if (id.includes('network')) networkFee += value;
    else if (id.includes('payment') || id.includes('card') || id.includes('bank')) paymentFee += value;
    else providerFee += value;
  }

  // If the breakdown is missing or does not reconcile, trust totalFee and
  // attribute the remainder to the provider rather than silently losing it.
  const accounted = providerFee + paymentFee + networkFee;
  if (Math.abs(accounted - totalFee) > 0.01) {
    providerFee += totalFee - accounted;
  }

  const warnings: string[] = [];

  // Transak discloses its own spread. When it does, sanity-check it against the
  // fees it reported: a conversion price materially worse than market that is
  // not reflected in totalFee is exactly the hidden cost this module exists to
  // surface, so say so on the quote itself.
  const conversion = toFiniteNumber(response.conversionPrice);
  const market = toFiniteNumber(response.marketConversionPrice);
  if (conversion && market && market > 0) {
    const disclosedSpreadPct = ((market - conversion) / market) * 100;
    if (disclosedSpreadPct > 0.5) {
      warnings.push(
        `Provider rate is ${disclosedSpreadPct.toFixed(2)}% below market, on top of the stated fee`
      );
    }
  }

  return {
    provider: 'transak',
    providerLabel: 'Transak',
    source: 'transak',
    paymentMethod:
      PAYMENT_METHOD_FROM_TRANSAK[(response.paymentMethod ?? '').toLowerCase()] ?? 'other',
    fiatCurrency: params.fiatCurrency.toUpperCase(),
    fiatAmount: params.fiatAmount,
    cryptoAsset: params.cryptoAsset,
    receiveAmount: cryptoAmount,
    fees: {
      provider: Math.max(0, providerFee),
      network: networkFee,
      payment: paymentFee,
      total: totalFee,
    },
    quotedRate: conversion,
    etaSeconds: null,
    minFiatAmount: null,
    maxFiatAmount: null,
    warnings,
  };
}

export class TransakProvider implements OnrampProvider {
  readonly id = 'transak';
  readonly label = 'Transak';

  private get apiKey(): string {
    return process.env.TRANSAK_API_KEY || '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async quote(params: OnrampQuoteParams, signal?: AbortSignal): Promise<RawOnrampQuote[]> {
    const { code, network } = transakAsset(params.cryptoAsset);

    const query = new URLSearchParams({
      partnerApiKey: this.apiKey,
      fiatCurrency: params.fiatCurrency.toUpperCase(),
      cryptoCurrency: code,
      network,
      isBuyOrSell: 'BUY',
      fiatAmount: String(params.fiatAmount),
    });

    const pm = params.paymentMethod && PAYMENT_METHOD_TO_TRANSAK[params.paymentMethod];
    if (pm) query.set('paymentMethod', pm);

    const response = await fetch(`${transakHosts().api}/api/v1/pricing/public/quotes?${query}`, {
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Transak API error ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }

    const quote = parseQuote((await response.json()) as TransakQuoteResponse, params);
    return quote ? [quote] : [];
  }

  /**
   * Hosted-widget hand-off. As with Onramper, Transak is merchant of record —
   * the user's card or bank is charged by them, and a dispute is theirs.
   */
  async createSession(params: OnrampSessionParams): Promise<OnrampSession> {
    if (!this.isConfigured()) {
      throw new Error('Transak is not configured');
    }

    const { code, network } = transakAsset(params.cryptoAsset);
    const query = new URLSearchParams({
      apiKey: this.apiKey,
      productsAvailed: 'BUY',
      fiatCurrency: params.fiatCurrency.toUpperCase(),
      fiatAmount: String(params.fiatAmount),
      cryptoCurrencyCode: code,
      network,
      walletAddress: params.walletAddress,
      disableWalletAddressForm: 'true',
    });

    if (params.redirectUrl) query.set('redirectURL', params.redirectUrl);
    if (params.externalId) query.set('partnerOrderId', params.externalId);
    const pm = params.paymentMethod && PAYMENT_METHOD_TO_TRANSAK[params.paymentMethod];
    if (pm) query.set('paymentMethod', pm);

    return {
      source: this.id,
      provider: 'transak',
      url: `${transakHosts().widget}?${query}`,
      sessionId: null,
      expiresAt: null,
    };
  }

  async listAssets(signal?: AbortSignal): Promise<OnrampAssets> {
    const response = await fetch(`${transakHosts().api}/api/v2/currencies/crypto-currencies`, {
      signal,
    });

    if (!response.ok) {
      throw new Error(`Transak API error ${response.status}`);
    }

    const body = (await response.json()) as {
      response?: Array<{ symbol?: string }>;
    };

    const crypto = (body?.response ?? [])
      .map((item) => item?.symbol)
      .filter((symbol): symbol is string => typeof symbol === 'string');

    return {
      source: this.id,
      // Transak's fiat list is a separate call; the router only needs the
      // crypto side to decide whether an asset is quotable at all.
      fiat: [],
      crypto: [...new Set(crypto)],
      paymentMethods: ['bank_transfer', 'card', 'apple_pay', 'google_pay', 'ewallet'],
    };
  }
}
