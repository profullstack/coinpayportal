/**
 * Remittance types — crypto in, local fiat out.
 *
 * The sender funds with stablecoin they already hold and the recipient is paid
 * in local currency through a partner's licensed payout rail. We never take the
 * sender's dollars, so the US money-transmission leg does not exist for us;
 * what remains is a payout integration that runs under the partner's licence.
 *
 * The ranking idea is the one from `src/lib/onramp`, moved one corridor over.
 * A remittance provider's disclosed fee is not its cost: on this market the
 * margin hides in the FX rate, and it is routinely larger than the visible fee.
 * Xoom on a $200 send to the Philippines charges $4.99 and takes another 4.49%
 * in the rate — two thirds of the cost is the part nobody quotes.
 *
 * So every quote here carries `receiveAmount` in local currency as its primary
 * field, and the router re-prices it against the mid-market FX rate to recover
 * the margin. That arithmetic lives in the router alone, so no provider adapter
 * can flatter its own numbers.
 */

/**
 * Corridors we serve.
 *
 * The `US-` prefix is nominal. The sender funds with stablecoin, so there is no
 * US fiat leg to speak of — the prefix records the jurisdiction the send side is
 * priced in (USD), not a bank account we touch. What actually distinguishes a
 * corridor is the destination: its currency, its payout rails and whether a
 * partner is licensed to pay into it.
 */
export type Corridor =
  // North America
  | 'US-MX'
  | 'US-CA'
  // Africa
  | 'US-NG'
  | 'US-KE'
  | 'US-GH'
  | 'US-ZA'
  | 'US-UG'
  | 'US-TZ'
  // South Asia
  | 'US-IN'
  | 'US-PK'
  | 'US-BD'
  | 'US-LK'
  | 'US-NP'
  // Southeast Asia
  | 'US-PH'
  | 'US-VN'
  | 'US-ID'
  | 'US-TH'
  | 'US-MY'
  | 'US-SG'
  // Middle East and North Africa
  | 'US-AE'
  | 'US-SA'
  | 'US-TR'
  | 'US-EG'
  // Euro area
  | 'US-IE'
  | 'US-DE'
  | 'US-FR'
  | 'US-ES'
  | 'US-IT'
  | 'US-NL'
  | 'US-PT'
  // Eastern Europe
  | 'US-PL'
  | 'US-RO'
  | 'US-UA'
  | 'US-CZ'
  | 'US-HU'
  | 'US-BG'
  | 'US-RS'
  // Oceania
  | 'US-AU'
  // South America
  | 'US-BR'
  | 'US-AR'
  | 'US-CO'
  | 'US-CL'
  | 'US-PE';

/** How the recipient actually gets the money. */
export type PayoutMethod = 'bank' | 'ewallet' | 'cash_pickup' | 'debit_card';

export interface CorridorSpec {
  corridor: Corridor;
  destinationCountry: string;
  payoutCurrency: string;
  /** Payout rails available in this corridor. */
  methods: PayoutMethod[];
  /**
   * Named networks per method — the recipient picks one of these, and in the
   * Philippines the e-wallet choice matters more than the bank rail does.
   */
  networks: Partial<Record<PayoutMethod, string[]>>;
  /**
   * Set when no single "mid-market" rate is meaningful for this currency.
   *
   * The naira trades at a persistent premium on the parallel market over the
   * official NFEM rate — a few percent apart at the time of writing. Our FX
   * reference quotes the official one, so a partner pricing off the street rate
   * looks like it has a *negative* margin. That is an artefact of comparing two
   * different markets, not a bargain, and the router says so on the quote
   * rather than publishing a confident wrong number.
   */
  fxReferenceContested?: boolean;
  /**
   * Set for developed-market corridors where incumbents are already efficient.
   *
   * The cost argument that carries US→MX or US→NG does not carry here: Wise
   * moves USD→CAD or USD→EUR for well under 1% all-in, so we are at parity
   * rather than an order of magnitude cheaper. These corridors are still worth
   * serving — settling from stablecoin in minutes has its own value — but the
   * UI must not dress parity up as a saving.
   */
  matureCorridor?: boolean;
}

export const CORRIDORS: Record<Corridor, CorridorSpec> = {
  'US-MX': {
    corridor: 'US-MX',
    destinationCountry: 'MX',
    payoutCurrency: 'MXN',
    methods: ['bank', 'cash_pickup', 'debit_card'],
    networks: {
      // SPEI settles 24/7 and is the reason this corridor is cheap.
      bank: ['spei'],
      cash_pickup: ['oxxo', 'elektra', 'banorte'],
      debit_card: ['dimo'],
    },
  },
  'US-PH': {
    corridor: 'US-PH',
    destinationCountry: 'PH',
    payoutCurrency: 'PHP',
    methods: ['bank', 'ewallet', 'cash_pickup'],
    networks: {
      bank: ['instapay', 'pesonet'],
      // E-wallet first: for Philippine families GCash matters more than the
      // bank rails do.
      ewallet: ['gcash', 'maya'],
      cash_pickup: ['cebuana', 'mlhuillier', 'palawan'],
    },
  },
  'US-NG': {
    corridor: 'US-NG',
    destinationCountry: 'NG',
    payoutCurrency: 'NGN',
    methods: ['bank', 'ewallet'],
    networks: {
      // NIP (NIBSS Instant Payment) reaches every Nigerian bank, and the
      // fintech wallets are built on top of it rather than beside it.
      bank: ['nip'],
      ewallet: ['opay', 'palmpay', 'kuda'],
    },
    fxReferenceContested: true,
  },
  'US-VN': {
    corridor: 'US-VN',
    destinationCountry: 'VN',
    payoutCurrency: 'VND',
    methods: ['bank', 'ewallet'],
    networks: {
      bank: ['napas247', 'vietqr'],
      ewallet: ['momo', 'zalopay', 'vnpay'],
    },
  },
  'US-CA': {
    corridor: 'US-CA',
    destinationCountry: 'CA',
    payoutCurrency: 'CAD',
    methods: ['bank'],
    networks: {
      // Interac e-Transfer is the dominant CAD rail and settles in minutes
      // under CAD 10,000; EFT is the batch alternative for larger amounts.
      bank: ['interac', 'eft'],
    },
    matureCorridor: true,
  },
  'US-IE': {
    corridor: 'US-IE',
    destinationCountry: 'IE',
    payoutCurrency: 'EUR',
    methods: ['bank'],
    networks: {
      // SEPA Instant clears in seconds and is the default across the euro
      // area; plain SCT is the next-business-day fallback.
      bank: ['sepa_instant', 'sepa'],
    },
    matureCorridor: true,
  },

  // ---------------------------------------------------------------- Africa
  // Mobile money is the account of record here, not the bank account. Paying
  // into a bank and leaving the recipient to reach a branch defeats the point,
  // so `ewallet` leads in every East and West African corridor below.
  'US-KE': {
    corridor: 'US-KE',
    destinationCountry: 'KE',
    payoutCurrency: 'KES',
    methods: ['ewallet', 'bank'],
    networks: {
      // M-Pesa is not one wallet among several in Kenya; it is the rail.
      ewallet: ['mpesa', 'airtel_money'],
      bank: ['pesalink'],
    },
  },
  'US-GH': {
    corridor: 'US-GH',
    destinationCountry: 'GH',
    payoutCurrency: 'GHS',
    methods: ['ewallet', 'bank'],
    networks: {
      ewallet: ['mtn_momo', 'telecel_cash', 'airteltigo_money'],
      // GhIPSS Instant Pay is the interbank rail the wallets settle across.
      bank: ['gip'],
    },
  },
  'US-ZA': {
    corridor: 'US-ZA',
    destinationCountry: 'ZA',
    payoutCurrency: 'ZAR',
    methods: ['bank'],
    networks: {
      // PayShap is the instant low-value rail; EFT is the batch fallback.
      bank: ['payshap', 'eft'],
    },
  },
  'US-UG': {
    corridor: 'US-UG',
    destinationCountry: 'UG',
    payoutCurrency: 'UGX',
    methods: ['ewallet', 'bank'],
    networks: {
      ewallet: ['mtn_momo', 'airtel_money'],
      bank: ['eft'],
    },
  },
  'US-TZ': {
    corridor: 'US-TZ',
    destinationCountry: 'TZ',
    payoutCurrency: 'TZS',
    methods: ['ewallet', 'bank'],
    networks: {
      ewallet: ['mpesa', 'tigo_pesa', 'airtel_money'],
      bank: ['tips'],
    },
  },

  // ------------------------------------------------------------ South Asia
  'US-IN': {
    corridor: 'US-IN',
    destinationCountry: 'IN',
    payoutCurrency: 'INR',
    methods: ['bank'],
    networks: {
      // UPI carries retail volume, IMPS is the 24/7 interbank rail beneath it,
      // and NEFT is the batch fallback above UPI's per-transaction cap. India
      // is a compliance question before it is an engineering one — see the
      // inbound-remittance note in docs/REMITTANCE.md.
      bank: ['upi', 'imps', 'neft'],
    },
  },
  'US-PK': {
    corridor: 'US-PK',
    destinationCountry: 'PK',
    payoutCurrency: 'PKR',
    methods: ['bank', 'ewallet'],
    networks: {
      // Raast is the state instant rail; IBFT is the older interbank transfer.
      bank: ['raast', 'ibft'],
      ewallet: ['easypaisa', 'jazzcash'],
    },
  },
  'US-BD': {
    corridor: 'US-BD',
    destinationCountry: 'BD',
    payoutCurrency: 'BDT',
    methods: ['ewallet', 'bank'],
    networks: {
      ewallet: ['bkash', 'nagad', 'rocket'],
      bank: ['beftn', 'npsb'],
    },
  },
  'US-LK': {
    corridor: 'US-LK',
    destinationCountry: 'LK',
    payoutCurrency: 'LKR',
    methods: ['bank'],
    networks: {
      bank: ['lankapay', 'ceft'],
    },
  },
  'US-NP': {
    corridor: 'US-NP',
    destinationCountry: 'NP',
    payoutCurrency: 'NPR',
    methods: ['ewallet', 'bank'],
    networks: {
      ewallet: ['esewa', 'khalti'],
      bank: ['connectips', 'fonepay'],
    },
  },

  // -------------------------------------------------------- Southeast Asia
  'US-ID': {
    corridor: 'US-ID',
    destinationCountry: 'ID',
    payoutCurrency: 'IDR',
    methods: ['bank', 'ewallet'],
    networks: {
      // BI-FAST is Bank Indonesia's instant rail; SKN is the batch clearing.
      bank: ['bifast', 'skn'],
      ewallet: ['gopay', 'ovo', 'dana', 'shopeepay'],
    },
  },
  'US-TH': {
    corridor: 'US-TH',
    destinationCountry: 'TH',
    payoutCurrency: 'THB',
    methods: ['bank', 'ewallet'],
    networks: {
      // PromptPay resolves a national ID or phone number to an account, so a
      // Thai recipient rarely needs to hand over bank details at all.
      bank: ['promptpay'],
      ewallet: ['truemoney'],
    },
  },
  'US-MY': {
    corridor: 'US-MY',
    destinationCountry: 'MY',
    payoutCurrency: 'MYR',
    methods: ['bank', 'ewallet'],
    networks: {
      bank: ['duitnow', 'fpx'],
      ewallet: ['touchngo', 'grabpay'],
    },
  },
  'US-SG': {
    corridor: 'US-SG',
    destinationCountry: 'SG',
    payoutCurrency: 'SGD',
    methods: ['bank'],
    networks: {
      bank: ['paynow', 'fast'],
    },
    matureCorridor: true,
  },

  // ------------------------------------------- Middle East and North Africa
  'US-AE': {
    corridor: 'US-AE',
    destinationCountry: 'AE',
    payoutCurrency: 'AED',
    methods: ['bank'],
    networks: {
      // Aani is the new instant rail; UAEFTS is the established interbank one.
      bank: ['aani', 'uaefts'],
    },
    matureCorridor: true,
  },
  'US-SA': {
    corridor: 'US-SA',
    destinationCountry: 'SA',
    payoutCurrency: 'SAR',
    methods: ['bank'],
    networks: {
      bank: ['sarie', 'sadad'],
    },
    matureCorridor: true,
  },
  'US-TR': {
    corridor: 'US-TR',
    destinationCountry: 'TR',
    payoutCurrency: 'TRY',
    methods: ['bank', 'ewallet'],
    networks: {
      // FAST is Turkey's instant rail, EFT the older interbank transfer.
      bank: ['fast', 'eft'],
      ewallet: ['papara'],
    },
  },
  'US-EG': {
    corridor: 'US-EG',
    destinationCountry: 'EG',
    payoutCurrency: 'EGP',
    methods: ['bank', 'ewallet'],
    networks: {
      bank: ['instapay', 'ach'],
      ewallet: ['vodafone_cash', 'etisalat_cash'],
    },
    // The pound has repeatedly traded away from its official rate, so a partner
    // pricing off the street looks mispriced against our reference. Same
    // artefact as the naira: flag it rather than resolve it.
    fxReferenceContested: true,
  },

  // ------------------------------------------------------------- Euro area
  // Every euro corridor is the same two rails and differs only by the country
  // the recipient banks in. SEPA Instant clears in seconds; plain SCT is the
  // next-business-day fallback. Wise already moves USD→EUR for well under 1%,
  // so all of these are mature: what we sell is settling from stablecoin in
  // minutes, not a cheaper rate.
  'US-DE': {
    corridor: 'US-DE',
    destinationCountry: 'DE',
    payoutCurrency: 'EUR',
    methods: ['bank'],
    networks: { bank: ['sepa_instant', 'sepa'] },
    matureCorridor: true,
  },
  'US-FR': {
    corridor: 'US-FR',
    destinationCountry: 'FR',
    payoutCurrency: 'EUR',
    methods: ['bank'],
    networks: { bank: ['sepa_instant', 'sepa'] },
    matureCorridor: true,
  },
  'US-ES': {
    corridor: 'US-ES',
    destinationCountry: 'ES',
    payoutCurrency: 'EUR',
    methods: ['bank'],
    networks: { bank: ['sepa_instant', 'sepa'] },
    matureCorridor: true,
  },
  'US-IT': {
    corridor: 'US-IT',
    destinationCountry: 'IT',
    payoutCurrency: 'EUR',
    methods: ['bank'],
    networks: { bank: ['sepa_instant', 'sepa'] },
    matureCorridor: true,
  },
  'US-NL': {
    corridor: 'US-NL',
    destinationCountry: 'NL',
    payoutCurrency: 'EUR',
    methods: ['bank'],
    networks: { bank: ['sepa_instant', 'sepa'] },
    matureCorridor: true,
  },
  'US-PT': {
    corridor: 'US-PT',
    destinationCountry: 'PT',
    payoutCurrency: 'EUR',
    methods: ['bank'],
    networks: { bank: ['sepa_instant', 'sepa'] },
    matureCorridor: true,
  },

  // -------------------------------------------------------- Eastern Europe
  // In the EU or its payment area but outside the euro, so the payout lands in
  // local currency and the FX leg is real rather than nominal.
  'US-PL': {
    corridor: 'US-PL',
    destinationCountry: 'PL',
    payoutCurrency: 'PLN',
    methods: ['bank', 'ewallet'],
    networks: {
      bank: ['express_elixir', 'elixir'],
      // BLIK is a phone-number transfer most Poles reach for ahead of an IBAN.
      ewallet: ['blik'],
    },
  },
  'US-RO': {
    corridor: 'US-RO',
    destinationCountry: 'RO',
    payoutCurrency: 'RON',
    methods: ['bank'],
    networks: { bank: ['sent', 'sepa'] },
  },
  'US-UA': {
    corridor: 'US-UA',
    destinationCountry: 'UA',
    payoutCurrency: 'UAH',
    methods: ['bank'],
    networks: {
      bank: ['sep', 'privat24'],
    },
    // Capital controls hold an official rate the cash market does not honour,
    // so the reference disagrees with what a partner can actually transact.
    fxReferenceContested: true,
  },
  'US-CZ': {
    corridor: 'US-CZ',
    destinationCountry: 'CZ',
    payoutCurrency: 'CZK',
    methods: ['bank'],
    networks: { bank: ['certis', 'sepa'] },
  },
  'US-HU': {
    corridor: 'US-HU',
    destinationCountry: 'HU',
    payoutCurrency: 'HUF',
    methods: ['bank'],
    networks: { bank: ['afr', 'sepa'] },
  },
  'US-BG': {
    corridor: 'US-BG',
    destinationCountry: 'BG',
    payoutCurrency: 'BGN',
    methods: ['bank'],
    networks: { bank: ['bisera', 'sepa'] },
  },
  'US-RS': {
    corridor: 'US-RS',
    destinationCountry: 'RS',
    payoutCurrency: 'RSD',
    methods: ['bank'],
    networks: { bank: ['ips', 'sepa'] },
  },

  // --------------------------------------------------------------- Oceania
  'US-AU': {
    corridor: 'US-AU',
    destinationCountry: 'AU',
    payoutCurrency: 'AUD',
    methods: ['bank'],
    networks: {
      // NPP clears in seconds and PayID addresses it by phone or email; BECS
      // is the overnight batch rail.
      bank: ['npp', 'payid', 'becs'],
    },
    matureCorridor: true,
  },

  // --------------------------------------------------------- South America
  'US-BR': {
    corridor: 'US-BR',
    destinationCountry: 'BR',
    payoutCurrency: 'BRL',
    methods: ['bank'],
    networks: {
      // Pix is instant, free to the recipient and universal. There is no
      // reason to offer a Brazilian recipient anything else.
      bank: ['pix'],
    },
  },
  'US-AR': {
    corridor: 'US-AR',
    destinationCountry: 'AR',
    payoutCurrency: 'ARS',
    methods: ['bank', 'ewallet'],
    networks: {
      bank: ['cvu', 'cbu'],
      ewallet: ['mercadopago'],
    },
    // The sharpest case of this anywhere: Argentina's official and parallel
    // rates have at times differed by more than half. A margin computed
    // against the official reference here is not a number worth publishing.
    fxReferenceContested: true,
  },
  'US-CO': {
    corridor: 'US-CO',
    destinationCountry: 'CO',
    payoutCurrency: 'COP',
    methods: ['bank', 'ewallet'],
    networks: {
      bank: ['pse', 'ach_co'],
      ewallet: ['nequi', 'daviplata'],
    },
  },
  'US-CL': {
    corridor: 'US-CL',
    destinationCountry: 'CL',
    payoutCurrency: 'CLP',
    methods: ['bank'],
    networks: { bank: ['cce', 'khipu'] },
  },
  'US-PE': {
    corridor: 'US-PE',
    destinationCountry: 'PE',
    payoutCurrency: 'PEN',
    methods: ['bank', 'ewallet'],
    networks: {
      bank: ['cce'],
      ewallet: ['yape', 'plin'],
    },
  },
};

export const SUPPORTED_CORRIDORS = Object.keys(CORRIDORS) as Corridor[];

/** Stablecoins a sender may fund with. */
export const SUPPORTED_SEND_ASSETS = [
  'USDC',
  'USDC_ETH',
  'USDC_POL',
  'USDC_SOL',
  'USDT',
  'USDT_ETH',
  'USDT_POL',
  'USDT_SOL',
] as const;

export type SendAsset = (typeof SUPPORTED_SEND_ASSETS)[number];

export function isSupportedSendAsset(asset: string): asset is SendAsset {
  return (SUPPORTED_SEND_ASSETS as readonly string[]).includes(asset);
}

/** Find the corridor for a destination country, or null. */
export function corridorFor(destinationCountry: string): CorridorSpec | null {
  const code = destinationCountry.toUpperCase();
  return Object.values(CORRIDORS).find((spec) => spec.destinationCountry === code) ?? null;
}

/** The ticker an asset is priced with — `USDC_POL` prices as `USDC`. */
export function pricingSymbol(asset: string): string {
  return asset.split('_')[0].toUpperCase();
}

export interface RemittanceQuoteParams {
  /** Stablecoin the sender is funding with. */
  sendAsset: string;
  /** Amount of that asset, in its own units. */
  sendAmount: number;
  /** ISO 3166-1 alpha-2 of the destination, e.g. "MX". */
  destinationCountry: string;
  payoutMethod?: PayoutMethod;
  /** A specific rail, e.g. "gcash" or "spei". */
  payoutNetwork?: string;
}

/** Fees in USD — the common denominator across corridors. */
export interface RemittanceFees {
  /** The partner's disclosed cut. */
  provider: number;
  /** Chain cost to move the stablecoin to them. */
  network: number;
  /** Local rail cost, where the partner itemises it. */
  payout: number;
  total: number;
}

export interface RawRemittanceQuote {
  provider: string;
  providerLabel: string;
  source: string;
  corridor: Corridor;
  sendAsset: string;
  sendAmount: number;
  payoutCurrency: string;
  payoutMethod: PayoutMethod;
  payoutNetwork: string | null;
  /** Local currency the recipient actually receives. The number that matters. */
  receiveAmount: number;
  fees: RemittanceFees;
  /** The partner's own FX rate, local currency per 1 USD. */
  quotedFxRate: number | null;
  etaSeconds: number | null;
  minSendAmountUsd: number | null;
  maxSendAmountUsd: number | null;
  warnings: string[];
}

/** A raw quote re-priced against mid-market FX. */
export interface RemittanceQuote extends RawRemittanceQuote {
  /** USD value of what the sender is sending, at crypto spot. */
  sendValueUsd: number | null;
  /** Mid-market FX, local currency per 1 USD. */
  midMarketFxRate: number | null;
  /**
   * The margin taken in the rate, as a percentage of principal — the part of
   * the cost that is not in the disclosed fee. Null when FX is unavailable;
   * never guessed.
   */
  fxMarginPct: number | null;
  /** Fees and FX margin together, against a mid-market send. */
  allInCostPct: number | null;
  /** What a zero-cost transfer would have delivered. */
  midMarketReceiveAmount: number | null;
}

export interface RemittanceUnavailable {
  source: string;
  reason: string;
}

export interface RemittanceQuoteResult {
  /** Ranked best-first by `receiveAmount`. */
  quotes: RemittanceQuote[];
  best: RemittanceQuote | null;
  corridor: Corridor;
  payoutCurrency: string;
  sendValueUsd: number | null;
  midMarketFxRate: number | null;
  unavailable: RemittanceUnavailable[];
}

/**
 * A remittance payout source.
 *
 * Same contract shape as the swap and on-ramp providers, for the same reason:
 * adding a corridor partner must never mean touching the router.
 */
export interface RemittanceProvider {
  readonly id: string;
  readonly label: string;
  /** Corridors this partner can actually pay into. */
  readonly corridors: Corridor[];
  isConfigured(): boolean;
  quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]>;
}

/** True when this partner serves the corridor at all. */
export function servesCorridor(provider: RemittanceProvider, corridor: Corridor): boolean {
  return provider.corridors.includes(corridor);
}
