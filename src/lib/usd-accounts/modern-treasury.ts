/**
 * Modern Treasury: the first Global USD accounts partner.
 *
 * Written against MT's public docs (docs.moderntreasury.com, read 2026-11-22),
 * NOT yet against a sandbox: our KYB was submitted 2026-11-22 and is pending.
 * Every shape the docs do not show for the Global USD / stablecoin part is a
 * named constant below marked `UNVERIFIED: confirm against MT sandbox`, so the
 * first sandbox session is a checklist rather than a hunt.
 *
 * ## What the docs DO establish
 *
 * - Base URL https://app.moderntreasury.com/api, HTTP Basic with
 *   `organization_id:api_key`. Sandbox and live share the host; the key decides.
 * - `Idempotency-Key` on every POST/PATCH, max 180 chars, kept 24 h.
 * - Webhooks: `X-Signature` = hex HMAC-SHA256 of the raw body keyed with the
 *   webhook key. Envelope `{ event, data }`. `X-Webhook-ID` is unique per
 *   webhook and stable across retries, so it is our dedupe key. `X-Topic`
 *   names the object type.
 * - Global USD accounts run on MT's PSP connection ("Modern Treasury Payment
 *   Accounts"): a legal entity (the user, KYC'd by MT), internal accounts owned
 *   by that legal entity (a USD one with ABA routing details, a USDC one with a
 *   wallet address), counterparties for external wallets, and payment orders.
 *   Virtual accounts are NOT available on the PSP, so every user gets their own
 *   internal account.
 * - Hosted KYC: `POST /api/embeddable_flows` with
 *   `template: "legal_entity_onboarding"` returns a `hosted_url`.
 * - USD to USDC is a `book` payment order (USD internal account to USDC
 *   internal account, currency USDC); USDC to the user's wallet is a
 *   `stablecoin` payment order to a counterparty wallet account. USDC on
 *   Ethereum, Solana, Base, Arbitrum and Polygon.
 *
 * ## The open question this adapter does not paper over
 *
 * MT's docs show conversion and delivery as payment orders that the PLATFORM
 * creates, one per leg. They do not document an automatic sweep rule. So either
 * MT offers auto-conversion for Global USD accounts (UNVERIFIED), or CoinPay
 * would have to create those payment orders on the user's standing instruction.
 * The second keeps the money in user-named accounts end to end, but it is
 * CoinPay instructing movement of user funds, and that is a decision for
 * Anthony and counsel, not for an adapter. Until then this adapter creates no
 * payment orders at all: it only reads them from webhooks.
 */

import { verifyHmacSha256Hex } from './signature';
import {
  AccountHolder,
  CreateAccountHolderRequest,
  DepositRail,
  HolderStatus,
  OpenAccountRequest,
  StablecoinChain,
  UsdAccount,
  UsdAccountEvent,
  UsdAccountProvider,
  UsdAccountStatus,
  WebhookParseResult,
  last4,
} from './types';

export const MT_API_URL = 'https://app.moderntreasury.com/api';
export const MT_SIGNATURE_HEADER = 'x-signature';
export const MT_WEBHOOK_ID_HEADER = 'x-webhook-id';
export const MT_EVENT_ID_HEADER = 'x-event-id';
export const MT_TOPIC_HEADER = 'x-topic';
/** Documented maximum for Idempotency-Key. */
const MT_IDEMPOTENCY_KEY_MAX = 180;

/** Chains MT documents for USDC. Optimism is not on the list. */
export const MT_CHAINS: readonly StablecoinChain[] = ['ethereum', 'solana', 'base', 'arbitrum', 'polygon'];

/**
 * UNVERIFIED: confirm against MT sandbox.
 * MT publishes "more than 90 countries" and no list. This default is the
 * markets we are targeting first; override with MODERN_TREASURY_USD_COUNTRIES
 * (comma-separated ISO alpha-2) once MT confirms eligibility for our program.
 * The US is excluded on purpose: the product is for people outside it.
 */
export const MT_DEFAULT_COUNTRIES: readonly string[] = [
  // Africa
  'NG', 'KE', 'GH', 'ZA', 'UG', 'TZ', 'RW', 'EG',
  // South and Southeast Asia
  'IN', 'PK', 'BD', 'LK', 'NP', 'PH', 'VN', 'ID', 'TH', 'MY', 'SG',
  // Latin America
  'MX', 'BR', 'AR', 'CO', 'CL', 'PE',
  // EU / EEA
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // Other
  'GB', 'CA', 'AU', 'AE',
];

/**
 * UNVERIFIED: confirm against MT sandbox.
 * The docs say a legal entity can be created with `status: "draft"` and
 * submitted later, but do not say which of the individual's required fields
 * (date_of_birth, phone_numbers, addresses, identifications, terms_of_use) a
 * draft may omit. We send only what we have (email, optional names) and let
 * MT's hosted flow collect the rest.
 */
export const MT_LEGAL_ENTITY_DRAFT_STATUS = 'draft';

/**
 * UNVERIFIED: confirm against MT sandbox.
 * The embeddable flow documents `options.type` and `options.return_url`, and
 * RETURNS `options.legal_entity_id`. Whether it ACCEPTS a legal_entity_id to
 * resume onboarding of an existing draft entity is not documented. If it does
 * not, the holder id must become the flow id until the flow completes.
 */
export const MT_FLOW_LEGAL_ENTITY_OPTION = 'legal_entity_id';
export const MT_FLOW_TEMPLATE = 'legal_entity_onboarding';

/**
 * UNVERIFIED: confirm against MT sandbox.
 * `requested_account_number_types` values are documented on internal accounts
 * (`ethereum_address`, `solana_address`, `polygon_address`, `base_address`,
 * `arbitrum_address`); the counterparty wallet example only shows
 * `ethereum_address`. We assume the same enum on both.
 */
export const MT_ADDRESS_TYPE: Record<string, string> = {
  ethereum: 'ethereum_address',
  solana: 'solana_address',
  polygon: 'polygon_address',
  base: 'base_address',
  arbitrum: 'arbitrum_address',
};

/** Documented: `self_hosted_wallet` for a wallet the user controls (no VASP routing detail). */
export const MT_SELF_HOSTED_WALLET = 'self_hosted_wallet';

/**
 * UNVERIFIED: confirm against MT sandbox.
 * `fednow` is NOT in the documented incoming_payment_detail `type` enum, even
 * though MT says FedNow pushes are received. Whatever MT actually sends is
 * mapped here; unknown types record as `unknown` rather than being dropped.
 */
export const MT_IPD_TYPE_TO_RAIL: Record<string, DepositRail> = {
  ach: 'ach',
  wire: 'wire',
  rtp: 'rtp',
  fednow: 'fednow',
  book: 'book',
};

/**
 * UNVERIFIED: confirm against MT sandbox.
 * Where a completed `stablecoin` payment order carries the on-chain tx hash.
 * Not documented. Tried in order; null if none is present.
 */
export const MT_TX_HASH_PATHS: readonly string[][] = [
  ['transaction_hash'],
  ['reference_numbers', '0', 'reference_number'],
];

/**
 * UNVERIFIED: confirm against MT sandbox.
 * How a conversion/delivery payment order is linked back to the incoming
 * deposit it came from. Nothing links them natively; whoever creates the
 * payment orders (MT auto-sweep, or us) must put the IPD id in metadata under
 * this key. Without it each leg shows as its own line.
 */
export const MT_DEPOSIT_LINK_METADATA_KEY = 'incoming_payment_detail_id';

/**
 * UNVERIFIED: confirm against MT sandbox.
 * The book-transfer example uses `currency: "USDC"` with `amount: 100000`
 * without saying whether that is cents or USDC base units (6 decimals). We
 * read USDC amounts as base units, which is what the IPD object documents.
 */
export const MT_USDC_DECIMALS = 6;

/** The internal_account example shows `account.activated`; the event table says `activated`. Accept both. */
const ACCOUNT_ACTIVATED = new Set(['activated', 'account.activated']);
const ACCOUNT_CLOSED = new Set(['closed', 'account.closed']);

function holderStatus(status: string | undefined): HolderStatus {
  switch (status) {
    case 'active':
      return 'verified';
    case 'denied':
      return 'rejected';
    case 'pending':
      return 'pending';
    // draft: the user has not finished onboarding. suspended: MT opened a case
    // that needs the user.
    default:
      return 'needs_action';
  }
}

function accountStatus(status: string | undefined): UsdAccountStatus {
  switch (status) {
    case 'active':
      return 'open';
    case 'pending_closure':
    case 'closed':
      return 'closed';
    default:
      return 'pending';
  }
}

function dig(obj: unknown, path: readonly string[]): unknown {
  let cur: any = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function key(base: string, suffix: string): string {
  return `${base}:${suffix}`.slice(0, MT_IDEMPOTENCY_KEY_MAX);
}

interface MtInternalAccount {
  id?: string;
  status?: string;
  currency?: string;
  legal_entity_id?: string | null;
  account_details?: Array<{ account_number?: string; account_number_safe?: string; account_number_type?: string }>;
  routing_details?: Array<{ routing_number?: string; routing_number_type?: string; payment_type?: string | null; bank_name?: string }>;
}

export function toUsdAccount(ia: MtInternalAccount, relatedIds: string[] = []): UsdAccount {
  const bankDetail = (ia.account_details ?? []).find((d) => !String(d.account_number_type ?? '').endsWith('_address'));
  const aba = (ia.routing_details ?? []).filter((r) => r.routing_number_type === 'aba');
  // `account_number` is hidden unless MT's Data Privacy setting is off; only
  // the safe last four may be present.
  const full = str(bankDetail?.account_number);
  const rails = [...new Set(aba.map((r) => r.payment_type).filter((t): t is string => !!t))]
    .map((t) => MT_IPD_TYPE_TO_RAIL[t] ?? 'unknown')
    .filter((r) => r !== 'unknown');
  return {
    id: ia.id ?? '',
    provider: 'modern_treasury',
    holderId: ia.legal_entity_id ?? null,
    status: accountStatus(ia.status),
    providerStatus: ia.status ?? '',
    bankName: aba[0]?.bank_name ?? null,
    routingNumber: aba[0]?.routing_number ?? null,
    accountNumber: full,
    accountLast4: last4(full) ?? last4(bankDetail?.account_number_safe),
    rails: rails.length ? rails : ['ach', 'wire'],
    relatedIds,
  };
}

export class ModernTreasuryProvider implements UsdAccountProvider {
  readonly id = 'modern_treasury';
  readonly label = 'Modern Treasury';
  readonly supportedChains = MT_CHAINS;

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  get supportedCountries(): readonly string[] {
    const raw = process.env.MODERN_TREASURY_USD_COUNTRIES;
    if (!raw) return MT_DEFAULT_COUNTRIES;
    return raw
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.MODERN_TREASURY_ORG_ID &&
        process.env.MODERN_TREASURY_API_KEY &&
        process.env.MODERN_TREASURY_WEBHOOK_KEY,
    );
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const org = process.env.MODERN_TREASURY_ORG_ID;
    const apiKey = process.env.MODERN_TREASURY_API_KEY;
    if (!org || !apiKey) throw new Error('Modern Treasury is not configured');
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${org}:${apiKey}`).toString('base64')}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, MT_IDEMPOTENCY_KEY_MAX);

    const res = await this.fetchImpl(`${MT_API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const message = json?.errors?.message ?? json?.message ?? `HTTP ${res.status}`;
      const err = new Error(`Modern Treasury ${method} ${path} failed: ${message}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json as T;
  }

  private async createOnboardingFlow(legalEntityId: string, idempotencyKey?: string, signal?: AbortSignal) {
    const returnUrl = `${(process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com').replace(/\/$/, '')}/usd-account`;
    const flow = await this.request<{ hosted_url?: string; status?: string }>(
      'POST',
      '/embeddable_flows',
      {
        template: MT_FLOW_TEMPLATE,
        options: { type: 'individual', return_url: returnUrl, [MT_FLOW_LEGAL_ENTITY_OPTION]: legalEntityId },
      },
      idempotencyKey,
      signal,
    );
    return str(flow?.hosted_url);
  }

  async createAccountHolder(request: CreateAccountHolderRequest, signal?: AbortSignal): Promise<AccountHolder> {
    const entity = await this.request<{ id?: string; status?: string }>(
      'POST',
      '/legal_entities',
      {
        legal_entity_type: 'individual',
        status: MT_LEGAL_ENTITY_DRAFT_STATUS,
        email: request.email,
        ...(request.firstName ? { first_name: request.firstName } : {}),
        ...(request.lastName ? { last_name: request.lastName } : {}),
        metadata: { coinpay_reference: request.reference },
      },
      key(request.idempotencyKey, 'legal-entity'),
      signal,
    );
    if (!entity?.id) throw new Error('Modern Treasury returned a legal entity without an id');
    const status = holderStatus(entity.status);
    const onboardingUrl =
      status === 'verified' || status === 'rejected'
        ? null
        : await this.createOnboardingFlow(entity.id, key(request.idempotencyKey, 'flow'), signal);
    return { id: entity.id, provider: this.id, status, providerStatus: entity.status ?? '', onboardingUrl };
  }

  async getAccountHolder(id: string, signal?: AbortSignal): Promise<AccountHolder | null> {
    let entity: { id?: string; status?: string };
    try {
      entity = await this.request('GET', `/legal_entities/${encodeURIComponent(id)}`, undefined, undefined, signal);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
    const status = holderStatus(entity.status);
    // Flows expire seven days after last activity, so a user still onboarding
    // gets a fresh link rather than a dead one.
    const onboardingUrl = status === 'needs_action' ? await this.createOnboardingFlow(id, undefined, signal) : null;
    return { id, provider: this.id, status, providerStatus: entity.status ?? '', onboardingUrl };
  }

  /**
   * Open the user's accounts: a USD internal account (the routing and account
   * number they hand out), a USDC internal account, and a counterparty for the
   * wallet USDC is delivered to. All owned by the user's legal entity; none
   * are CoinPay's.
   */
  async openAccount(request: OpenAccountRequest, signal?: AbortSignal): Promise<UsdAccount> {
    const addressType = MT_ADDRESS_TYPE[request.destination.chain];
    if (!addressType) throw new Error(`Modern Treasury does not deliver USDC on ${request.destination.chain}`);
    const connection = process.env.MODERN_TREASURY_CONNECTION_ID;
    const metadata = { coinpay_reference: request.reference };

    const usd = await this.request<MtInternalAccount>(
      'POST',
      '/internal_accounts',
      {
        currency: 'USD',
        legal_entity_id: request.holderId,
        name: 'CoinPay Global USD',
        metadata,
        ...(connection ? { connection_id: connection } : {}),
      },
      key(request.idempotencyKey, 'usd'),
      signal,
    );
    const usdc = await this.request<MtInternalAccount>(
      'POST',
      '/internal_accounts',
      {
        currency: 'USDC',
        legal_entity_id: request.holderId,
        name: 'CoinPay Global USD (USDC)',
        requested_account_number_types: [addressType],
        metadata,
        ...(connection ? { connection_id: connection } : {}),
      },
      key(request.idempotencyKey, 'usdc'),
      signal,
    );
    const wallet = await this.request<{ id?: string }>(
      'POST',
      '/counterparties',
      {
        name: `CoinPay wallet ${request.reference}`,
        metadata,
        accounts: [
          {
            account_type: MT_SELF_HOSTED_WALLET,
            party_type: 'individual',
            account_details: [{ account_number: request.destination.address, account_number_type: addressType }],
          },
        ],
      },
      key(request.idempotencyKey, 'wallet'),
      signal,
    );
    if (!usd?.id) throw new Error('Modern Treasury returned an internal account without an id');
    const related = [usdc?.id, wallet?.id].filter((v): v is string => !!v);
    return toUsdAccount(usd, related);
  }

  async getAccount(id: string, signal?: AbortSignal): Promise<UsdAccount | null> {
    try {
      const ia = await this.request<MtInternalAccount>(
        'GET',
        `/internal_accounts/${encodeURIComponent(id)}`,
        undefined,
        undefined,
        signal,
      );
      return toUsdAccount(ia);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  verifyAndParseWebhook(rawBody: string, headers: Record<string, string>): WebhookParseResult {
    const secret = process.env.MODERN_TREASURY_WEBHOOK_KEY || '';
    if (!secret) return { ok: false, reason: 'MODERN_TREASURY_WEBHOOK_KEY is not set' };
    if (!verifyHmacSha256Hex(rawBody, headers[MT_SIGNATURE_HEADER], secret)) {
      return { ok: false, reason: 'signature verification failed' };
    }
    let body: { event?: string; data?: Record<string, any> };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: 'invalid JSON' };
    }
    const eventId = str(headers[MT_WEBHOOK_ID_HEADER]) ?? str(headers[MT_EVENT_ID_HEADER]);
    if (!eventId) return { ok: false, reason: 'missing X-Webhook-ID' };
    const event = parseMtEvent(eventId, headers[MT_TOPIC_HEADER] ?? null, body);
    return { ok: true, events: event ? [event] : [] };
  }
}

/** Translate one verified MT webhook. Null for anything we do not act on. */
export function parseMtEvent(
  eventId: string,
  topicHeader: string | null,
  body: { event?: string; data?: Record<string, any> },
): UsdAccountEvent | null {
  const data = body.data ?? {};
  const name = String(body.event ?? '');
  const topic = topicHeader || String(data.object ?? '');
  const providerType = `${topic}.${name}`;
  const occurredAt = str(data.updated_at) ?? str(data.created_at);
  const base = { eventId, providerType, occurredAt, raw: body };
  const id = str(data.id);
  if (!id) return null;

  if (topic === 'legal_entity') {
    if (name === 'activated') return { ...base, type: 'holder.verified', holderId: id, reason: null };
    if (name === 'denied') return { ...base, type: 'holder.rejected', holderId: id, reason: str(data.status_reason) };
    return null;
  }

  if (topic === 'internal_account') {
    // Only the USD account is "the account"; the USDC one is a related id.
    if (String(data.currency ?? '').toUpperCase() !== 'USD') return null;
    const holderId = str(data.legal_entity_id);
    if (ACCOUNT_ACTIVATED.has(name)) return { ...base, type: 'account.opened', accountId: id, holderId };
    if (ACCOUNT_CLOSED.has(name)) return { ...base, type: 'account.closed', accountId: id, holderId };
    return null;
  }

  if (topic === 'incoming_payment_detail') {
    if (data.direction !== 'credit' || String(data.currency ?? '').toUpperCase() !== 'USD') return null;
    const accountId = str(data.internal_account_id);
    if (!accountId || !Number.isInteger(data.amount)) return null;
    const type =
      name === 'completed' ? 'deposit.received' : name === 'returned' ? 'deposit.returned' : null;
    if (!type) return null;
    return {
      ...base,
      type,
      accountId,
      depositId: id,
      amountMinor: data.amount,
      currency: 'USD',
      rail: MT_IPD_TYPE_TO_RAIL[String(data.type)] ?? 'unknown',
      deliveredAmountAtomic: null,
      deliveredAsset: null,
      deliveredChain: null,
      txHash: null,
      returnCode: null,
    };
  }

  if (topic === 'payment_order') {
    if (name !== 'completed') return null;
    if (String(data.currency ?? '').toUpperCase() !== 'USDC') return null;
    const accountId = str(data.originating_account_id);
    if (!accountId || !Number.isInteger(data.amount)) return null;
    const isConversion = data.type === 'book';
    const isDelivery = data.type === 'stablecoin';
    if (!isConversion && !isDelivery) return null;
    const atomic = BigInt(data.amount);
    const cents = Number(atomic / BigInt(10 ** (MT_USDC_DECIMALS - 2)));
    let txHash: string | null = null;
    for (const path of MT_TX_HASH_PATHS) {
      txHash = str(dig(data, path));
      if (txHash) break;
    }
    return {
      ...base,
      type: isConversion ? 'deposit.converted' : 'deposit.delivered',
      accountId,
      depositId: str(dig(data, ['metadata', MT_DEPOSIT_LINK_METADATA_KEY])) ?? id,
      amountMinor: cents,
      currency: 'USD',
      rail: 'unknown',
      deliveredAmountAtomic: atomic.toString(),
      deliveredAsset: 'USDC',
      deliveredChain: null,
      txHash: isDelivery ? txHash : null,
      returnCode: null,
    };
  }

  return null;
}
