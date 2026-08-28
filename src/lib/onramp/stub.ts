/**
 * Synthetic on-ramp source for development.
 *
 * We have no provider credentials yet, and waiting for them would mean the
 * router, the routes and the UI all stay unexercised until the day a key
 * arrives. This source emits quotes shaped like the real market so everything
 * above the provider interface can be built and tested now.
 *
 * The numbers are modelled on published rates: a card quote around 4.5% with a
 * minimum fee, and a bank-transfer quote around 1% — both carrying a spread
 * that the disclosed fee does not mention, which is the behaviour the router
 * exists to expose.
 *
 * SAFETY: this refuses to run in production even when the flag is set. A
 * fabricated quote shown to someone about to spend real money is a worse
 * failure than showing them no quote at all.
 */

import {
  OnrampAssets,
  OnrampProvider,
  OnrampQuoteParams,
  OnrampSession,
  OnrampSessionParams,
  RawOnrampQuote,
  ONRAMP_SUPPORTED_ASSETS,
} from './types';

/** Reference prices, fiat per 1 unit. Only used to synthesise a plausible fill. */
const REFERENCE_PRICE: Record<string, number> = {
  BTC: 95_000,
  BCH: 480,
  ETH: 3_200,
  POL: 0.45,
  SOL: 190,
  BNB: 640,
  DOGE: 0.24,
  XRP: 2.3,
  ADA: 0.9,
  USDT: 1,
  USDC: 1,
};

interface StubShape {
  provider: string;
  label: string;
  method: 'card' | 'bank_transfer';
  /** Disclosed fee, as a fraction of principal. */
  feeRate: number;
  /** Floor on the disclosed fee, in fiat units. */
  feeMinimum: number;
  /** Undisclosed margin baked into the rate. */
  spread: number;
  etaSeconds: number;
}

/**
 * Deliberately includes a case where the cheaper *disclosed* fee is the worse
 * deal, because that is the whole argument for ranking on delivered amount.
 * "Lunaramp" quotes 1% and takes 3.1% in spread; "Pilotramp" quotes 1.9% and
 * takes 0.4%. Ranked on fee percentage the user picks wrong.
 */
const STUB_SHAPES: StubShape[] = [
  {
    provider: 'lunaramp',
    label: 'Lunaramp',
    method: 'bank_transfer',
    feeRate: 0.01,
    feeMinimum: 3.99,
    spread: 0.031,
    etaSeconds: 172_800,
  },
  {
    provider: 'pilotramp',
    label: 'Pilotramp',
    method: 'bank_transfer',
    feeRate: 0.019,
    feeMinimum: 0,
    spread: 0.004,
    etaSeconds: 86_400,
  },
  {
    provider: 'lunaramp',
    label: 'Lunaramp',
    method: 'card',
    feeRate: 0.045,
    feeMinimum: 3.99,
    spread: 0.021,
    etaSeconds: 600,
  },
];

function referencePrice(cryptoAsset: string): number {
  const base = cryptoAsset.split('_')[0].toUpperCase();
  return REFERENCE_PRICE[base] ?? 1;
}

export class StubOnrampProvider implements OnrampProvider {
  readonly id = 'stub';
  readonly label = 'Development stub';

  isConfigured(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    return process.env.ONRAMP_ENABLE_STUB === '1';
  }

  async quote(params: OnrampQuoteParams): Promise<RawOnrampQuote[]> {
    const price = referencePrice(params.cryptoAsset);

    return STUB_SHAPES.filter(
      (shape) => !params.paymentMethod || shape.method === params.paymentMethod
    ).map((shape) => {
      const disclosedFee = Math.max(params.fiatAmount * shape.feeRate, shape.feeMinimum);
      const networkFee = shape.method === 'card' ? 1.5 : 0.75;

      // Fees come off the top, then the remainder converts at a rate worsened
      // by the spread — which is exactly how a real ramp arrives at its payout.
      const principal = Math.max(0, params.fiatAmount - disclosedFee - networkFee);
      const effectivePrice = price * (1 + shape.spread);

      return {
        provider: shape.provider,
        providerLabel: shape.label,
        source: this.id,
        paymentMethod: shape.method,
        fiatCurrency: params.fiatCurrency.toUpperCase(),
        fiatAmount: params.fiatAmount,
        cryptoAsset: params.cryptoAsset,
        receiveAmount: principal / effectivePrice,
        fees: {
          provider: disclosedFee,
          network: networkFee,
          payment: 0,
          total: disclosedFee + networkFee,
        },
        quotedRate: effectivePrice,
        etaSeconds: shape.etaSeconds,
        minFiatAmount: 20,
        maxFiatAmount: 20_000,
        warnings: ['Synthetic quote from the development stub — not a real offer'],
      };
    });
  }

  async createSession(params: OnrampSessionParams): Promise<OnrampSession> {
    return {
      source: this.id,
      provider: params.provider ?? 'stub',
      url: `https://example.invalid/onramp-stub?asset=${encodeURIComponent(
        params.cryptoAsset
      )}&amount=${encodeURIComponent(String(params.fiatAmount))}`,
      sessionId: 'stub-session',
      expiresAt: null,
    };
  }

  async listAssets(): Promise<OnrampAssets> {
    return {
      source: this.id,
      fiat: ['USD', 'EUR', 'GBP'],
      crypto: ONRAMP_SUPPORTED_ASSETS,
      paymentMethods: ['bank_transfer', 'card'],
    };
  }
}
