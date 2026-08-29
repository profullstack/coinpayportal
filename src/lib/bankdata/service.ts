/**
 * Bank-data persistence and orchestration.
 *
 * Sits between the API routes and the provider adapter: owns encryption of the access
 * token, the sync loop, and the mapping to `bank_connections` / `bank_accounts` /
 * `bank_transactions`. Routes stay thin and never touch a provider directly.
 *
 * Every function takes the caller's Supabase client (service-role, RLS bypassed), so
 * authorization must already have happened in the route via `src/lib/auth/authz.ts`.
 */

import { decrypt, encrypt } from '@/lib/crypto/encryption';
import { requireEncryptionKey } from '@/lib/crypto/require-key';
import { getBankDataProvider } from './index';
import { reconcileSettlements, type ExpectedSettlement, type ReconciliationResult } from './reconcile';
import {
  BankDataError,
  type BankConnectionStatus,
  type BankTransaction,
  type LinkExchange,
} from './types';

// Matches the loose client typing used by the other services in this repo (see
// src/lib/payouts/service.ts): routes pass a service-role client built at the edge.
type SupabaseClient = any;

/** Guard against a runaway loop if a provider never stops reporting `has_more`. */
const MAX_SYNC_PAGES = 50;

/** A connection as it is safe to hand to the client — no credential material. */
export interface PublicBankConnection {
  id: string;
  provider: string;
  institutionName: string | null;
  status: BankConnectionStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface ConnectionRow {
  id: string;
  business_id: string;
  provider: string;
  institution_name: string | null;
  access_token_encrypted: string;
  sync_cursor: string | null;
  status: BankConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

function toPublic(row: ConnectionRow): PublicBankConnection {
  return {
    id: row.id,
    provider: row.provider,
    institutionName: row.institution_name,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

/**
 * Persist a completed link.
 *
 * Upserts on `(provider, provider_item_id)` so that a merchant re-running Link for an
 * institution they already connected refreshes the credential in place. Inserting
 * instead would double every transaction the next time reconciliation ran.
 */
export async function saveConnection(
  supabase: SupabaseClient,
  params: { businessId: string; exchange: LinkExchange },
): Promise<PublicBankConnection> {
  const provider = getBankDataProvider();
  const encrypted = encrypt(params.exchange.accessToken, requireEncryptionKey('bankdata'));

  const { data, error } = await supabase
    .from('bank_connections')
    .upsert(
      {
        business_id: params.businessId,
        provider: provider.name,
        provider_item_id: params.exchange.providerItemId,
        institution_id: params.exchange.institutionId,
        institution_name: params.exchange.institutionName,
        access_token_encrypted: encrypted,
        status: 'active',
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'provider,provider_item_id' },
    )
    .select()
    .single();

  if (error) throw new BankDataError(`Failed to save connection: ${error.message}`, provider.name);
  return toPublic(data as ConnectionRow);
}

export async function listConnections(
  supabase: SupabaseClient,
  businessId: string,
): Promise<PublicBankConnection[]> {
  const { data, error } = await supabase
    .from('bank_connections')
    .select('*')
    .eq('business_id', businessId)
    .neq('status', 'disconnected')
    .order('created_at', { ascending: false });

  if (error) throw new BankDataError(`Failed to list connections: ${error.message}`, 'plaid');
  return ((data ?? []) as ConnectionRow[]).map(toPublic);
}

/** Load a connection, scoped to the business so an id from another tenant cannot be read. */
async function loadConnection(
  supabase: SupabaseClient,
  businessId: string,
  connectionId: string,
): Promise<ConnectionRow> {
  const { data, error } = await supabase
    .from('bank_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (error) throw new BankDataError(`Failed to load connection: ${error.message}`, 'plaid');
  if (!data) throw new BankDataError('Connection not found', 'plaid', 'NOT_FOUND');
  return data as ConnectionRow;
}

/**
 * Disconnect an institution.
 *
 * Revokes upstream first: if we deleted our row and the revoke then failed, we would
 * have lost the only handle to a live credential that still reads someone's bank.
 */
export async function removeConnection(
  supabase: SupabaseClient,
  businessId: string,
  connectionId: string,
): Promise<void> {
  const row = await loadConnection(supabase, businessId, connectionId);
  const provider = getBankDataProvider();

  const accessToken = decrypt(row.access_token_encrypted, requireEncryptionKey('bankdata'));
  await provider.removeConnection(accessToken);

  const { error } = await supabase.from('bank_connections').delete().eq('id', connectionId);
  if (error) throw new BankDataError(`Failed to delete connection: ${error.message}`, provider.name);
}

export interface SyncSummary {
  added: number;
  modified: number;
  removed: number;
  accounts: number;
}

/**
 * Pull every change since the stored cursor and persist it.
 *
 * Accounts are upserted before transactions because each transaction row references a
 * `bank_accounts.id`; a transaction for an account we have not seen yet would otherwise
 * be dropped. The cursor is only advanced after a page is written, so a crash mid-sync
 * re-fetches that page rather than skipping it.
 */
export async function syncConnection(
  supabase: SupabaseClient,
  businessId: string,
  connectionId: string,
): Promise<SyncSummary> {
  const row = await loadConnection(supabase, businessId, connectionId);
  const provider = getBankDataProvider();
  const accessToken = decrypt(row.access_token_encrypted, requireEncryptionKey('bankdata'));

  const summary: SyncSummary = { added: 0, modified: 0, removed: 0, accounts: 0 };

  try {
    const accounts = await provider.listAccounts(accessToken);
    summary.accounts = accounts.length;

    if (accounts.length > 0) {
      const { error } = await supabase.from('bank_accounts').upsert(
        accounts.map((account) => ({
          connection_id: connectionId,
          provider_account_id: account.providerAccountId,
          name: account.name,
          mask: account.mask,
          type: account.type,
          subtype: account.subtype,
          current_balance_minor: account.currentBalanceMinor,
          available_balance_minor: account.availableBalanceMinor,
          currency: account.currency,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'connection_id,provider_account_id' },
      );
      if (error) throw new BankDataError(`Failed to store accounts: ${error.message}`, provider.name);
    }

    // Resolve provider account ids to our primary keys for the transaction rows.
    const { data: accountRows } = await supabase
      .from('bank_accounts')
      .select('id, provider_account_id')
      .eq('connection_id', connectionId);

    const accountIdByProviderId = new Map<string, string>(
      ((accountRows ?? []) as Array<{ id: string; provider_account_id: string }>).map((a) => [
        a.provider_account_id,
        a.id,
      ]),
    );

    let cursor = row.sync_cursor;
    let pages = 0;

    for (;;) {
      const page = await provider.syncTransactions(accessToken, cursor);

      const upserts = [...page.added, ...page.modified]
        .map((transaction) => {
          const accountId = accountIdByProviderId.get(transaction.providerAccountId);
          // A transaction for an account the provider did not list is unusable — we
          // have nowhere to hang it. Skip rather than fabricate an account row.
          if (!accountId) return null;
          return {
            connection_id: connectionId,
            account_id: accountId,
            provider_transaction_id: transaction.providerTransactionId,
            amount_minor: transaction.amountMinor,
            currency: transaction.currency,
            posted_on: transaction.date,
            description: transaction.description,
            counterparty: transaction.counterparty,
            pending: transaction.pending,
            category: transaction.category,
            updated_at: new Date().toISOString(),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      if (upserts.length > 0) {
        const { error } = await supabase
          .from('bank_transactions')
          .upsert(upserts, { onConflict: 'connection_id,provider_transaction_id' });
        if (error) {
          throw new BankDataError(`Failed to store transactions: ${error.message}`, provider.name);
        }
      }

      if (page.removedIds.length > 0) {
        await supabase
          .from('bank_transactions')
          .delete()
          .eq('connection_id', connectionId)
          .in('provider_transaction_id', page.removedIds);
      }

      summary.added += page.added.length;
      summary.modified += page.modified.length;
      summary.removed += page.removedIds.length;
      cursor = page.nextCursor;

      // Persist after each page so an interrupted sync resumes instead of restarting.
      await supabase
        .from('bank_connections')
        .update({ sync_cursor: cursor, updated_at: new Date().toISOString() })
        .eq('id', connectionId);

      pages += 1;
      if (!page.hasMore || pages >= MAX_SYNC_PAGES) break;
    }

    await supabase
      .from('bank_connections')
      .update({
        status: 'active',
        last_synced_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId);

    return summary;
  } catch (error) {
    // Record why syncing stopped so the dashboard can prompt a re-link rather than
    // silently showing stale balances.
    const isBankError = error instanceof BankDataError;
    await supabase
      .from('bank_connections')
      .update({
        status: isBankError && error.requiresReauth ? 'reauth_required' : 'error',
        last_error: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId);
    throw error;
  }
}

export interface TransactionQuery {
  connectionId?: string;
  /** Inclusive ISO `YYYY-MM-DD` bounds. */
  from?: string;
  to?: string;
  limit?: number;
}

/** List stored transactions for a business, newest first. */
export async function listTransactions(
  supabase: SupabaseClient,
  businessId: string,
  query: TransactionQuery = {},
): Promise<BankTransaction[]> {
  const { data: connectionRows } = await supabase
    .from('bank_connections')
    .select('id')
    .eq('business_id', businessId);

  const connectionIds = ((connectionRows ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (connectionIds.length === 0) return [];

  let builder = supabase
    .from('bank_transactions')
    .select('*')
    .in('connection_id', query.connectionId ? [query.connectionId] : connectionIds)
    .order('posted_on', { ascending: false })
    .limit(Math.min(query.limit ?? 250, 1000));

  if (query.from) builder = builder.gte('posted_on', query.from);
  if (query.to) builder = builder.lte('posted_on', query.to);

  const { data, error } = await builder;
  if (error) throw new BankDataError(`Failed to list transactions: ${error.message}`, 'plaid');

  interface TransactionRow {
    provider_transaction_id: string;
    account_id: string;
    amount_minor: number;
    currency: string;
    posted_on: string;
    description: string;
    counterparty: string | null;
    pending: boolean;
    category: string | null;
  }

  return ((data ?? []) as TransactionRow[]).map((r) => ({
    providerTransactionId: r.provider_transaction_id,
    providerAccountId: r.account_id,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    date: String(r.posted_on).slice(0, 10),
    description: r.description,
    counterparty: r.counterparty,
    pending: r.pending,
    category: r.category,
  }));
}

/**
 * Load the fiat settlements CoinPay believes it sent to this merchant's bank.
 *
 * Today the only such source is `stripe_payouts` (amount is a bigint of MINOR units,
 * matching Stripe's own convention; `arrival_date` is when the money is expected to
 * land, which is what a bank credit should line up with).
 *
 * Note for whoever picks this up: `stripe_payouts` is EMPTY in production and the
 * Stripe Connect account is terminated, so this returns nothing today. That is why the
 * matcher is kept provider-neutral — when a crypto off-ramp lands, its payouts become a
 * second source here and reconciliation starts producing results without further
 * changes to the engine.
 */
export async function loadExpectedSettlements(
  supabase: SupabaseClient,
  merchantId: string,
  range: { from?: string; to?: string } = {},
): Promise<ExpectedSettlement[]> {
  let builder = supabase
    .from('stripe_payouts')
    .select('id, amount, currency, status, arrival_date, created_at')
    .eq('merchant_id', merchantId)
    // In-transit payouts are still expected to land, so they belong in the comparison.
    .in('status', ['paid', 'in_transit']);

  if (range.from) builder = builder.gte('arrival_date', range.from);
  if (range.to) builder = builder.lte('arrival_date', range.to);

  const { data, error } = await builder;
  if (error) {
    throw new BankDataError(`Failed to load expected settlements: ${error.message}`, 'plaid');
  }

  interface PayoutRow {
    id: string;
    amount: number | string | null;
    currency: string | null;
    arrival_date: string | null;
    created_at: string | null;
  }

  return ((data ?? []) as PayoutRow[])
    .filter((row) => row.amount !== null && (row.arrival_date || row.created_at))
    .map((row) => ({
      id: String(row.id),
      amountMinor: Number(row.amount),
      currency: (row.currency || 'usd').toUpperCase(),
      date: String(row.arrival_date || row.created_at).slice(0, 10),
    }));
}

/** Reconcile a business's expected settlements against its imported bank credits. */
export async function reconcileBusiness(
  supabase: SupabaseClient,
  params: { businessId: string; merchantId: string; from?: string; to?: string },
): Promise<ReconciliationResult> {
  const [settlements, transactions] = await Promise.all([
    loadExpectedSettlements(supabase, params.merchantId, { from: params.from, to: params.to }),
    listTransactions(supabase, params.businessId, {
      from: params.from,
      to: params.to,
      limit: 1000,
    }),
  ]);

  return reconcileSettlements(settlements, transactions);
}
