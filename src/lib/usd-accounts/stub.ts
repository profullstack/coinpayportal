/**
 * An in-memory USD account partner, for development and tests.
 *
 * It opens no account and moves no money. It is hard-off in production: like
 * the banking and remittance stubs it needs an explicit opt-in
 * (USD_ACCOUNTS_ENABLE_STUB=1) AND refuses when NODE_ENV is production, so a
 * missing partner key can never fall back to fake routing numbers on a live
 * deployment. Every method re-checks the guard, not just isConfigured(), so a
 * caller that holds a stub instance directly still cannot use it in production.
 *
 * Webhooks are signed with HMAC-SHA256 over the raw body in `x-stub-signature`,
 * keyed with USD_ACCOUNTS_STUB_WEBHOOK_SECRET, and their body is already in our
 * normalised vocabulary: `{ id, type, ...fields }`.
 */

import { hmacSha256Hex, verifyHmacSha256Hex } from './signature';
import {
  AccountHolder,
  CreateAccountHolderRequest,
  DEPOSIT_EVENT_TYPES,
  DepositRail,
  OpenAccountRequest,
  StablecoinChain,
  STABLECOIN_CHAINS,
  UsdAccount,
  UsdAccountEvent,
  UsdAccountProvider,
  WebhookParseResult,
  last4,
} from './types';

export const STUB_SIGNATURE_HEADER = 'x-stub-signature';

/** A routing number that passes the ABA checksum and belongs to no bank we use. */
const STUB_ROUTING = '011000015';

export function stubAllowed(): boolean {
  return process.env.USD_ACCOUNTS_ENABLE_STUB === '1' && process.env.NODE_ENV !== 'production';
}

export function stubWebhookSecret(): string {
  return process.env.USD_ACCOUNTS_STUB_WEBHOOK_SECRET || '';
}

/** Sign a stub webhook body. Tests and local tooling use it to fake deliveries. */
export function signStubWebhook(rawBody: string, secret = stubWebhookSecret()): string {
  return hmacSha256Hex(rawBody, secret);
}

export class StubUsdAccountProvider implements UsdAccountProvider {
  readonly id = 'stub';
  readonly label = 'Stub (no account, no money)';
  readonly supportedCountries = ['NG', 'KE', 'GH', 'PH', 'IN', 'PK', 'MX', 'BR', 'DE', 'FR', 'ES', 'IE'] as const;
  readonly supportedChains: readonly StablecoinChain[] = STABLECOIN_CHAINS;

  private holders = new Map<string, AccountHolder>();
  private accounts = new Map<string, UsdAccount & { accountNumber: string }>();
  private byKey = new Map<string, string>();
  private counter = 0;

  private guard(): void {
    if (!stubAllowed()) {
      throw new Error('The USD account stub is disabled (production, or USD_ACCOUNTS_ENABLE_STUB is not 1)');
    }
  }

  isConfigured(): boolean {
    return stubAllowed();
  }

  async createAccountHolder(request: CreateAccountHolderRequest): Promise<AccountHolder> {
    this.guard();
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return this.holders.get(existing)!;
    const id = `stub_holder_${++this.counter}`;
    const holder: AccountHolder = {
      id,
      provider: this.id,
      status: 'needs_action',
      providerStatus: 'pending',
      onboardingUrl: `https://stub.invalid/onboarding/${id}`,
    };
    this.holders.set(id, holder);
    this.byKey.set(request.idempotencyKey, id);
    return holder;
  }

  async getAccountHolder(id: string): Promise<AccountHolder | null> {
    this.guard();
    return this.holders.get(id) ?? null;
  }

  async openAccount(request: OpenAccountRequest): Promise<UsdAccount> {
    this.guard();
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return this.accounts.get(existing)!;
    const holder = this.holders.get(request.holderId);
    if (!holder || holder.status !== 'verified') {
      throw new Error('Holder is not verified');
    }
    const id = `stub_acct_${++this.counter}`;
    const accountNumber = String(900000000000 + this.counter);
    const account = {
      id,
      provider: this.id,
      holderId: request.holderId,
      status: 'open' as const,
      providerStatus: 'active',
      bankName: 'Stub Bank, N.A.',
      routingNumber: STUB_ROUTING,
      accountNumber,
      accountLast4: last4(accountNumber),
      rails: ['ach', 'wire', 'rtp'] as DepositRail[],
      relatedIds: [] as string[],
    };
    this.accounts.set(id, account);
    this.byKey.set(request.idempotencyKey, id);
    return account;
  }

  async getAccount(id: string): Promise<UsdAccount | null> {
    this.guard();
    return this.accounts.get(id) ?? null;
  }

  /** Drive a holder through KYC, the way the partner's review eventually would. */
  setHolderStatus(id: string, status: AccountHolder['status']): AccountHolder {
    this.guard();
    const holder = this.holders.get(id);
    if (!holder) throw new Error(`No such holder: ${id}`);
    const next = { ...holder, status, providerStatus: status, onboardingUrl: status === 'needs_action' ? holder.onboardingUrl : null };
    this.holders.set(id, next);
    return next;
  }

  verifyAndParseWebhook(rawBody: string, headers: Record<string, string>): WebhookParseResult {
    if (!stubAllowed()) return { ok: false, reason: 'stub disabled' };
    const secret = stubWebhookSecret();
    if (!secret) return { ok: false, reason: 'USD_ACCOUNTS_STUB_WEBHOOK_SECRET is not set' };
    if (!verifyHmacSha256Hex(rawBody, headers[STUB_SIGNATURE_HEADER], secret)) {
      return { ok: false, reason: 'signature verification failed' };
    }
    let body: Record<string, any>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: 'invalid JSON' };
    }
    const event = toEvent(body);
    return event ? { ok: true, events: [event] } : { ok: false, reason: 'unrecognised stub event' };
  }

  /** Test seam. */
  reset(): void {
    this.holders.clear();
    this.accounts.clear();
    this.byKey.clear();
    this.counter = 0;
  }
}

function toEvent(body: Record<string, any>): UsdAccountEvent | null {
  const eventId = typeof body.id === 'string' ? body.id : '';
  const type = body.type as string;
  if (!eventId || typeof type !== 'string') return null;
  const base = { eventId, providerType: type, occurredAt: body.occurredAt ?? null, raw: body };
  if (type === 'holder.verified' || type === 'holder.rejected') {
    if (typeof body.holderId !== 'string') return null;
    return { ...base, type, holderId: body.holderId, reason: body.reason ?? null };
  }
  if (type === 'account.opened' || type === 'account.closed') {
    if (typeof body.accountId !== 'string') return null;
    return { ...base, type, accountId: body.accountId, holderId: body.holderId ?? null };
  }
  if ((DEPOSIT_EVENT_TYPES as readonly string[]).includes(type)) {
    if (typeof body.accountId !== 'string' || typeof body.depositId !== 'string') return null;
    if (!Number.isInteger(body.amountMinor)) return null;
    return {
      ...base,
      type: type as (typeof DEPOSIT_EVENT_TYPES)[number],
      accountId: body.accountId,
      depositId: body.depositId,
      amountMinor: body.amountMinor,
      currency: body.currency ?? 'USD',
      rail: body.rail ?? 'ach',
      deliveredAmountAtomic: body.deliveredAmountAtomic ?? null,
      deliveredAsset: body.deliveredAsset ?? null,
      deliveredChain: body.deliveredChain ?? null,
      txHash: body.txHash ?? null,
      returnCode: body.returnCode ?? null,
    };
  }
  return null;
}
