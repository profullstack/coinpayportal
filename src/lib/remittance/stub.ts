/**
 * Synthetic remittance partner for development.
 *
 * Lets the router, routes and any UI be exercised on both corridors before a
 * partner agreement exists. The numbers are modelled on published corridor
 * economics: incumbents land around 4.5% all-in into Mexico and 5–7% into the
 * Philippines, with most of that cost in the FX rate rather than the fee.
 *
 * SAFETY: refuses to run in production even when the flag is set. A fabricated
 * quote shown to someone about to send money to their family is a worse failure
 * than showing them no quote at all.
 */

import {
  Corridor,
  RawRemittanceQuote,
  RemittanceProvider,
  RemittanceQuoteParams,
  corridorFor,
} from './types';

/** Indicative mid-market rates, local currency per USD. */
const REFERENCE_FX: Record<string, number> = {
  MXN: 17,
  PHP: 58,
  // Official NFEM rate; the parallel market sits a few percent above it.
  NGN: 1347,
  VND: 26300,
  CAD: 1.37,
  EUR: 0.92,
};

interface StubShape {
  provider: string;
  label: string;
  /** Disclosed fee, as a fraction of principal. */
  feeRate: number;
  /** Floor on the disclosed fee, in USD. */
  feeMinimum: number;
  /** Undisclosed margin taken in the rate. */
  fxMargin: number;
  etaSeconds: number;
}

/**
 * Includes a partner whose disclosed fee is lower but whose payout is worse,
 * because that is the trap the router exists to catch. "Casaramp" charges a
 * flat $1.99 and takes 4.4% in the rate; "Rapidoramp" charges 1.5% and takes
 * 0.3%. Ranked on fee, the family receives less money.
 */
const STUB_SHAPES: StubShape[] = [
  {
    provider: 'casaramp',
    label: 'Casaramp',
    feeRate: 0,
    feeMinimum: 1.99,
    fxMargin: 0.044,
    etaSeconds: 86_400,
  },
  {
    provider: 'rapidoramp',
    label: 'Rapidoramp',
    feeRate: 0.015,
    feeMinimum: 0,
    fxMargin: 0.003,
    etaSeconds: 120,
  },
];

export class StubRemittanceProvider implements RemittanceProvider {
  readonly id = 'stub';
  readonly label = 'Development stub';
  readonly corridors: Corridor[] = [
    'US-MX',
    'US-PH',
    'US-NG',
    'US-VN',
    'US-CA',
    'US-IE',
  ];

  isConfigured(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    return process.env.REMITTANCE_ENABLE_STUB === '1';
  }

  async quote(params: RemittanceQuoteParams): Promise<RawRemittanceQuote[]> {
    const spec = corridorFor(params.destinationCountry);
    if (!spec) return [];

    const midMarket = REFERENCE_FX[spec.payoutCurrency];
    if (!midMarket) return [];

    return STUB_SHAPES.map((shape) => {
      const disclosedFee = Math.max(params.sendAmount * shape.feeRate, shape.feeMinimum);
      const networkFee = 0.5;
      const net = Math.max(0, params.sendAmount - disclosedFee - networkFee);

      // Fees come off the top, then the remainder converts at a rate worsened
      // by the margin — how a real operator arrives at its payout.
      const effectiveFx = midMarket * (1 - shape.fxMargin);

      return {
        provider: shape.provider,
        providerLabel: shape.label,
        source: this.id,
        corridor: spec.corridor,
        sendAsset: params.sendAsset,
        sendAmount: params.sendAmount,
        payoutCurrency: spec.payoutCurrency,
        payoutMethod: params.payoutMethod ?? 'bank',
        payoutNetwork: params.payoutNetwork ?? spec.networks.bank?.[0] ?? null,
        receiveAmount: net * effectiveFx,
        fees: {
          provider: disclosedFee,
          network: networkFee,
          payout: 0,
          total: disclosedFee + networkFee,
        },
        quotedFxRate: effectiveFx,
        etaSeconds: shape.etaSeconds,
        minSendAmountUsd: 10,
        maxSendAmountUsd: 2_999,
        warnings: ['Synthetic quote from the development stub — not a real offer'],
      };
    });
  }
}
