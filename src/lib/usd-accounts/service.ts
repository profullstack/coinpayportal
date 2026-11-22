/**
 * Global USD accounts: request an account, show it, record what the partner
 * reports.
 *
 * Non-custodial by construction (see ./types.ts): nothing in here moves money,
 * computes a balance or credits anyone. The partner holds the account in the
 * user's name and delivers converted USDC to the user's own wallet; this
 * service keeps references and an audit trail of the partner's webhooks.
 *
 * Idempotency, the same way src/lib/banking does it:
 *
 * - **Rows before partner calls.** The holder and account rows are inserted
 *   first, keyed by deterministic idempotency keys and unique per
 *   (merchant, provider). Two racing requests cannot create two holders or two
 *   accounts: the loser's insert fails and it re-reads the winner's row. The
 *   partner call carries the same key, so a retry after a timeout returns the
 *   partner's original object rather than a second one.
 * - **Webhook events are deduped by (provider, event_id).** Effects are applied
 *   first (they are status updates and an idempotent open-account call), then
 *   the event is recorded. A delivery whose effects failed leaves no row, so
 *   the partner's retry applies them again; a duplicate delivery is skipped.
 */

import { getActiveUsdAccountProvider, getUsdAccountProvider } from './providers';
import {
  UsdAccountsConflictError,
  type UsdAccountEventRow,
  type UsdAccountHolderRow,
  type UsdAccountRow,
  type UsdAccountStore,
} from './store';
import {
  AccountHolder,
  DepositEvent,
  DepositStatus,
  StablecoinDestination,
  UsdAccount,
  UsdAccountEvent,
  UsdAccountProvider,
  normalizeCountry,
  validateDestination,
} from './types';

export class UsdAccountsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UsdAccountsError';
  }
}

export interface UsdAccountsDeps {
  store: UsdAccountStore;
  /** Defaults to the active partner. Tests inject the stub, or null. */
  provider?: UsdAccountProvider | null;
  now?: () => Date;
}

function resolveProvider(deps: UsdAccountsDeps): UsdAccountProvider {
  const provider = deps.provider === undefined ? getActiveUsdAccountProvider() : deps.provider;
  if (!provider) throw new UsdAccountsError('Global USD accounts are not available', 503);
  return provider;
}

const now = (deps: UsdAccountsDeps) => (deps.now ? deps.now() : new Date()).toISOString();

export const holderKey = (merchantId: string, provider: string) => `usd-holder:${provider}:${merchantId}`;
export const accountKey = (merchantId: string, provider: string) => `usd-account:${provider}:${merchantId}`;

export interface RequestAccountInput {
  merchantId: string;
  email: string;
  country: unknown;
  firstName?: string;
  lastName?: string;
  destination: Partial<StablecoinDestination> | null | undefined;
}

function holderPatchFrom(holder: AccountHolder) {
  return {
    provider_holder_id: holder.id,
    status: holder.status,
    provider_status: holder.providerStatus,
    onboarding_url: holder.onboardingUrl,
  };
}

/**
 * Request a US account for a merchant.
 *
 * Safe to call repeatedly: the second call returns the same holder and account
 * (refreshing the onboarding link) rather than creating new ones. When KYC is
 * already verified the account is opened at once; otherwise it is opened when
 * the partner's `holder.verified` webhook arrives.
 */
export async function requestAccount(
  input: RequestAccountInput,
  deps: UsdAccountsDeps,
): Promise<{ holder: UsdAccountHolderRow; account: UsdAccountRow }> {
  const provider = resolveProvider(deps);

  const country = normalizeCountry(input.country);
  if (!country) throw new UsdAccountsError('country must be a two-letter ISO 3166 code', 400);
  if (!provider.supportedCountries.includes(country)) {
    throw new UsdAccountsError(`Global USD accounts are not available in ${country} yet`, 422);
  }

  const destination = input.destination
    ? { ...input.destination, address: (input.destination.address ?? '').trim() }
    : input.destination;
  const invalid = validateDestination(destination);
  if (invalid) throw new UsdAccountsError(invalid, 400);
  if (!provider.supportedChains.includes(destination!.chain!)) {
    throw new UsdAccountsError(`${provider.label} cannot deliver USDC on ${destination!.chain}`, 422);
  }
  if (!input.email) throw new UsdAccountsError('An email address is required', 400);

  // 1. Holder row, then partner holder.
  let holder = await deps.store.findHolder(input.merchantId, provider.id);
  if (holder?.status === 'rejected') {
    throw new UsdAccountsError(`${provider.label} declined this application`, 409);
  }
  if (!holder) {
    try {
      holder = await deps.store.insertHolder({
        merchant_id: input.merchantId,
        provider: provider.id,
        country,
        idempotency_key: holderKey(input.merchantId, provider.id),
      });
    } catch (err) {
      if (!(err instanceof UsdAccountsConflictError)) throw err;
      holder = await deps.store.findHolder(input.merchantId, provider.id);
      if (!holder) throw err;
    }
  }

  if (!holder.provider_holder_id) {
    const created = await provider.createAccountHolder({
      reference: holder.id,
      email: input.email,
      country,
      firstName: input.firstName,
      lastName: input.lastName,
      idempotencyKey: holder.idempotency_key,
    });
    holder = await deps.store.updateHolder(holder.id, holderPatchFrom(created));
  } else if (holder.status !== 'verified') {
    // Refresh: onboarding links expire, and the status may have moved without
    // a webhook reaching us.
    const fresh = await provider.getAccountHolder(holder.provider_holder_id);
    if (fresh) holder = await deps.store.updateHolder(holder.id, holderPatchFrom(fresh));
  }

  // 2. Account row (records the destination wallet even before KYC finishes).
  let account = await deps.store.findAccount(input.merchantId, provider.id);
  if (!account) {
    try {
      account = await deps.store.insertAccount({
        merchant_id: input.merchantId,
        holder_id: holder.id,
        provider: provider.id,
        destination_asset: 'USDC',
        destination_chain: destination!.chain!,
        destination_address: destination!.address!,
        idempotency_key: accountKey(input.merchantId, provider.id),
      });
    } catch (err) {
      if (!(err instanceof UsdAccountsConflictError)) throw err;
      account = await deps.store.findAccount(input.merchantId, provider.id);
      if (!account) throw err;
    }
  }

  // 3. Open it now if KYC is done.
  if (holder.status === 'verified') {
    account = await openIfReady(holder, account, provider, deps);
  }

  return { holder, account };
}

function accountPatchFrom(opened: UsdAccount, deps: UsdAccountsDeps) {
  return {
    provider_account_id: opened.id,
    provider_related_ids: opened.relatedIds,
    status: opened.status,
    provider_status: opened.providerStatus,
    bank_name: opened.bankName,
    routing_number: opened.routingNumber,
    // Last four only. `opened.accountNumber` is deliberately not persisted.
    account_last4: opened.accountLast4,
    rails: opened.rails,
    last_error: null,
    opened_at: opened.status === 'open' ? now(deps) : null,
  };
}

/** Ask the partner to open the account, once. Idempotent under the account's key. */
async function openIfReady(
  holder: UsdAccountHolderRow,
  account: UsdAccountRow,
  provider: UsdAccountProvider,
  deps: UsdAccountsDeps,
): Promise<UsdAccountRow> {
  if (holder.status !== 'verified' || !holder.provider_holder_id) return account;
  if (account.status !== 'requested' && account.status !== 'failed') return account;
  try {
    const opened = await provider.openAccount({
      holderId: holder.provider_holder_id,
      destination: {
        asset: 'USDC',
        chain: account.destination_chain as StablecoinDestination['chain'],
        address: account.destination_address,
      },
      reference: account.id,
      idempotencyKey: account.idempotency_key,
    });
    return await deps.store.updateAccount(account.id, accountPatchFrom(opened, deps));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return deps.store.updateAccount(account.id, { status: 'failed', last_error: message.slice(0, 500) });
  }
}

export interface PublicDeposit {
  depositId: string;
  status: DepositStatus;
  amountMinor: number | null;
  currency: string | null;
  rail: string | null;
  deliveredAmountAtomic: string | null;
  deliveredAsset: string | null;
  deliveredChain: string | null;
  txHash: string | null;
  returnCode: string | null;
  updatedAt: string;
}

const DEPOSIT_RANK: Record<DepositStatus, number> = { received: 0, converted: 1, delivered: 2, returned: 3 };

/**
 * Fold deposit events into one line per deposit, at its furthest reported
 * status. A display convenience over the partner's reports, not a ledger.
 */
export function foldDeposits(events: readonly UsdAccountEventRow[]): PublicDeposit[] {
  const byId = new Map<string, PublicDeposit>();
  for (const e of events) {
    if (!e.provider_deposit_id || !e.event_type.startsWith('deposit.')) continue;
    const status = e.event_type.slice('deposit.'.length) as DepositStatus;
    const prev = byId.get(e.provider_deposit_id);
    const merged: PublicDeposit = {
      depositId: e.provider_deposit_id,
      status: prev && DEPOSIT_RANK[prev.status] > DEPOSIT_RANK[status] ? prev.status : status,
      amountMinor: e.amount_minor ?? prev?.amountMinor ?? null,
      currency: e.currency ?? prev?.currency ?? null,
      rail: e.rail ?? prev?.rail ?? null,
      deliveredAmountAtomic: e.delivered_amount_atomic ?? prev?.deliveredAmountAtomic ?? null,
      deliveredAsset: e.delivered_asset ?? prev?.deliveredAsset ?? null,
      deliveredChain: e.delivered_chain ?? prev?.deliveredChain ?? null,
      txHash: e.tx_hash ?? prev?.txHash ?? null,
      returnCode: e.return_code ?? prev?.returnCode ?? null,
      updatedAt: prev && prev.updatedAt > e.received_at ? prev.updatedAt : e.received_at,
    };
    byId.set(e.provider_deposit_id, merged);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface UsdAccountStatusView {
  available: boolean;
  provider: { id: string; label: string; supportedCountries: readonly string[]; supportedChains: readonly string[] } | null;
  holder: {
    status: UsdAccountHolderRow['status'];
    country: string;
    onboardingUrl: string | null;
    rejectionReason: string | null;
  } | null;
  account: {
    status: UsdAccountRow['status'];
    bankName: string | null;
    routingNumber: string | null;
    /** Fetched live from the partner for this response only; null when the read failed. */
    accountNumber: string | null;
    accountLast4: string | null;
    rails: string[];
    destination: { asset: string; chain: string; address: string };
    openedAt: string | null;
    error: string | null;
  } | null;
  deposits: PublicDeposit[];
}

/** Everything the page needs. Returns `available: false` cleanly when off. */
export async function getStatus(merchantId: string, deps: UsdAccountsDeps): Promise<UsdAccountStatusView> {
  const provider = deps.provider === undefined ? getActiveUsdAccountProvider() : deps.provider;
  if (!provider) return { available: false, provider: null, holder: null, account: null, deposits: [] };

  const [holder, account] = await Promise.all([
    deps.store.findHolder(merchantId, provider.id),
    deps.store.findAccount(merchantId, provider.id),
  ]);

  let accountNumber: string | null = null;
  if (account?.status === 'open' && account.provider_account_id) {
    try {
      accountNumber = (await provider.getAccount(account.provider_account_id))?.accountNumber ?? null;
    } catch (err) {
      console.error('[usd-accounts] live account read failed', err);
    }
  }

  const deposits = account ? foldDeposits(await deps.store.listDepositEvents(account.id, 200)).slice(0, 25) : [];

  return {
    available: true,
    provider: {
      id: provider.id,
      label: provider.label,
      supportedCountries: provider.supportedCountries,
      supportedChains: provider.supportedChains,
    },
    holder: holder
      ? {
          status: holder.status,
          country: holder.country,
          onboardingUrl: holder.status === 'verified' || holder.status === 'rejected' ? null : holder.onboarding_url,
          rejectionReason: holder.rejection_reason,
        }
      : null,
    account: account
      ? {
          status: account.status,
          bankName: account.bank_name,
          routingNumber: account.routing_number,
          accountNumber,
          accountLast4: account.account_last4,
          rails: account.rails,
          destination: {
            asset: account.destination_asset,
            chain: account.destination_chain,
            address: account.destination_address,
          },
          openedAt: account.opened_at,
          error: account.status === 'failed' ? account.last_error : null,
        }
      : null,
    deposits,
  };
}

export interface WebhookOutcome {
  status: number;
  body: { received?: number; duplicates?: number; ignored?: number; error?: string };
}

/**
 * Verify, dedupe and apply one partner webhook delivery.
 *
 * Status codes are chosen for the partner's retry logic: 503 when the feature
 * or partner is off (retry later), 401 on a bad signature (do not trust), 200
 * otherwise, including for duplicates and for events about accounts we do not
 * know (retrying would not help).
 */
export async function handleWebhook(
  providerId: string,
  rawBody: string,
  headers: Record<string, string>,
  deps: UsdAccountsDeps,
): Promise<WebhookOutcome> {
  const provider = deps.provider === undefined ? getUsdAccountProvider(providerId) : deps.provider;
  if (!provider || provider.id !== providerId) {
    return { status: 503, body: { error: 'Global USD accounts are not available' } };
  }

  const parsed = provider.verifyAndParseWebhook(rawBody, headers);
  if (!parsed.ok) {
    console.warn(`[usd-accounts] rejected ${providerId} webhook: ${parsed.reason}`);
    return { status: 401, body: { error: 'Signature verification failed' } };
  }

  let received = 0;
  let duplicates = 0;
  let ignored = 0;
  for (const event of parsed.events) {
    if (!event.eventId) {
      ignored++;
      continue;
    }
    if (await deps.store.hasEvent(provider.id, event.eventId)) {
      duplicates++;
      continue;
    }
    const scope = await applyEvent(event, provider, deps);
    const inserted = await deps.store.insertEvent({
      provider: provider.id,
      event_id: event.eventId,
      event_type: event.type,
      provider_type: event.providerType,
      merchant_id: scope.merchantId,
      usd_account_id: scope.accountId,
      provider_account_id: 'accountId' in event ? event.accountId : null,
      provider_holder_id: 'holderId' in event ? event.holderId : null,
      provider_deposit_id: 'depositId' in event ? event.depositId : null,
      amount_minor: 'amountMinor' in event ? event.amountMinor : null,
      currency: 'currency' in event ? event.currency : null,
      rail: 'rail' in event ? event.rail : null,
      delivered_amount_atomic: 'deliveredAmountAtomic' in event ? event.deliveredAmountAtomic : null,
      delivered_asset: 'deliveredAsset' in event ? event.deliveredAsset : null,
      delivered_chain: 'deliveredChain' in event ? event.deliveredChain : null,
      tx_hash: 'txHash' in event ? event.txHash : null,
      return_code: 'returnCode' in event ? event.returnCode : null,
      occurred_at: event.occurredAt,
      payload: event.raw,
    });
    if (inserted) received++;
    else duplicates++;
  }
  return { status: 200, body: { received, duplicates, ignored } };
}

/** Apply one event's effect. Every effect is idempotent. Returns who it belongs to. */
async function applyEvent(
  event: UsdAccountEvent,
  provider: UsdAccountProvider,
  deps: UsdAccountsDeps,
): Promise<{ merchantId: string | null; accountId: string | null }> {
  const { store } = deps;

  if (event.type === 'holder.verified' || event.type === 'holder.rejected') {
    const holder = await store.findHolderByProviderId(provider.id, event.holderId);
    if (!holder) return { merchantId: null, accountId: null };
    const updated = await store.updateHolder(holder.id, {
      status: event.type === 'holder.verified' ? 'verified' : 'rejected',
      provider_status: event.providerType,
      onboarding_url: null,
      rejection_reason: event.type === 'holder.rejected' ? event.reason : null,
    });
    let account = await store.findAccountByHolder(holder.id);
    if (account && event.type === 'holder.verified') {
      account = await openIfReady(updated, account, provider, deps);
    }
    return { merchantId: holder.merchant_id, accountId: account?.id ?? null };
  }

  if (event.type === 'account.opened' || event.type === 'account.closed') {
    let account = await store.findAccountByProviderId(provider.id, event.accountId);
    if (!account && event.holderId) {
      // The open call may have timed out on our side after the partner made it.
      const holder = await store.findHolderByProviderId(provider.id, event.holderId);
      account = holder ? await store.findAccountByHolder(holder.id) : null;
    }
    if (!account) return { merchantId: null, accountId: null };
    if (event.type === 'account.opened') {
      const live = await provider.getAccount(event.accountId).catch(() => null);
      account = await store.updateAccount(
        account.id,
        live
          ? { ...accountPatchFrom(live, deps), status: 'open', opened_at: account.opened_at ?? now(deps) }
          : { provider_account_id: event.accountId, status: 'open', opened_at: account.opened_at ?? now(deps) },
      );
    } else {
      account = await store.updateAccount(account.id, { status: 'closed', closed_at: now(deps) });
    }
    return { merchantId: account.merchant_id, accountId: account.id };
  }

  // Deposits: recorded, never credited. The event row IS the record.
  const deposit = event as DepositEvent;
  const account = await store.findAccountByProviderId(provider.id, deposit.accountId);
  return { merchantId: account?.merchant_id ?? null, accountId: account?.id ?? null };
}
