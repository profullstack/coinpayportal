import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { encrypt, decrypt } from '../crypto/encryption';
import { requireEncryptionKey } from '../crypto/require-key';
import {
  collectErrors,
  parseAmount,
  unixToIso,
  parseAccessUrl,
  redactAccessUrl,
  type SimpleFinAccount,
} from './simplefin';
import { fetchAccountSetForProvider } from './provider';
import { removePlaidItem } from './plaid';
import { inferAccountKind, categorizeTransaction } from './classify';

/**
 * Pulling SimpleFIN into Postgres.
 *
 * Everything here is idempotent by construction: accounts key on
 * `(connection_id, external_id)` and transactions on `(account_id,
 * external_id)`, so re-syncing an already-imported window changes nothing but
 * `updated_at`. That matters because overlap is the normal case — a pending
 * transaction is rewritten when it posts, and each sync deliberately re-reads a
 * window it has read before so late-posting card charges are not missed.
 */

/**
 * How far back a sync reads when the caller does not say.
 *
 * 45 rather than 90: the bridge answers anything longer with `Requested date
 * range exceeds recommended range of 45 days. In the future, this may be
 * capped.` A rolling window this size is ample for a running view, and history
 * already imported is never removed — the tables only ever accumulate.
 */
export const DEFAULT_SYNC_DAYS = 45;

/**
 * The hard ceiling for an explicitly requested window.
 *
 * SimpleFIN's limit is 90 days, but asking for exactly 90 trips it: the window
 * is measured against the server's clock when the request lands, a fraction of
 * a second after the start date is computed. The bridge then answers
 * `Requested date range exceeds limit of 90 days and was capped`. 89 leaves
 * room for the round trip.
 */
export const MAX_SYNC_DAYS = 89;

/**
 * Messages the bridge returns that describe an adjustment it made, not an
 * institution that failed.
 *
 * These arrive in the same `errors` array as "Chase needs reauthentication",
 * and treating them alike marks a complete sync as `partial` — which trains
 * the operator to ignore the one signal that means a bank has actually stopped
 * answering. Matching is deliberately narrow: anything not recognised here
 * stays a real error.
 */
const ADVISORY_PATTERNS = [
  /exceeds (the )?recommended range/i,
  /and was capped/i,
];

export function isAdvisory(message: string): boolean {
  return ADVISORY_PATTERNS.some((pattern) => pattern.test(message));
}

/** PostgREST rejects very large payloads; upserts go up in chunks of this size. */
const UPSERT_CHUNK = 500;

export interface SyncResult {
  connectionId: string;
  accounts: number;
  transactionsSeen: number;
  transactionsNew: number;
  /** Institution-level failures SimpleFIN reported without failing the request. */
  errors: string[];
  /** Advisories from the bridge — informational, and not a failure. */
  notices: string[];
  status: 'ok' | 'partial';
}

export interface FinanceConnectionRow {
  id: string;
  provider: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_sync_accounts: number | null;
  last_sync_transactions: number | null;
}

/** Columns safe to return to a client — never the encrypted access URL. */
const CONNECTION_COLUMNS =
  'id, provider, label, is_active, created_at, last_synced_at, last_sync_status, last_sync_error, last_sync_accounts, last_sync_transactions';

/**
 * Store a freshly claimed access URL.
 *
 * Encryption is not optional: `requireEncryptionKey` throws rather than falling
 * back to a constant, because this credential is a live read feed into
 * somebody's bank and a setup token cannot be re-claimed to rotate it.
 */
export async function createConnection(params: {
  merchantId: string;
  accessUrl: string;
  label?: string | null;
}): Promise<FinanceConnectionRow> {
  // Reject a malformed URL before it is encrypted and becomes hard to inspect.
  parseAccessUrl(params.accessUrl);

  const key = requireEncryptionKey('finance connection storage');
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('finance_connections')
    .insert({
      provider: 'simplefin',
      merchant_id: params.merchantId,
      label: params.label?.trim() || null,
      access_url_encrypted: encrypt(params.accessUrl, key),
    })
    .select(CONNECTION_COLUMNS)
    .single();

  if (error) throw new Error(`Could not save the SimpleFIN connection: ${error.message}`);
  return data as FinanceConnectionRow;
}

/**
 * Store a Plaid access token as a connection.
 *
 * Separate from `createConnection` because the credentials are not
 * interchangeable: a SimpleFIN access URL is a URL and is validated as one,
 * whereas a Plaid access token is an opaque string. They share the column —
 * both are "the encrypted credential for this connection" — but nothing else.
 *
 * The label defaults to the institution name resolved at exchange time, which
 * is also what names the account's org on every subsequent sync.
 */
export async function createPlaidConnection(params: {
  merchantId: string;
  accessToken: string;
  label?: string | null;
}): Promise<FinanceConnectionRow> {
  if (!params.accessToken.trim()) {
    throw new Error('Plaid returned an empty access token');
  }

  const key = requireEncryptionKey('finance connection storage');
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('finance_connections')
    .insert({
      provider: 'plaid',
      merchant_id: params.merchantId,
      label: params.label?.trim() || null,
      access_url_encrypted: encrypt(params.accessToken, key),
    })
    .select(CONNECTION_COLUMNS)
    .single();

  if (error) throw new Error(`Could not save the Plaid connection: ${error.message}`);
  return data as FinanceConnectionRow;
}

/**
 * One merchant's connections, without their credentials.
 *
 * There is no unscoped variant of this on purpose. `SIMPLEFIN_ACCESS_URL` is
 * also no longer read anywhere: an earlier version adopted it as a connection
 * whenever the table was empty, which was harmless for single-tenant admin
 * tooling but under per-merchant ownership would have handed one person's bank
 * accounts to whichever merchant happened to link first.
 */
export async function listConnections(merchantId: string): Promise<FinanceConnectionRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_connections')
    .select(CONNECTION_COLUMNS)
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Could not list finance connections: ${error.message}`);
  return (data ?? []) as FinanceConnectionRow[];
}

/**
 * Decrypt one connection's access URL.
 *
 * Scoped by `merchant_id` in the same query that fetches the credential, so a
 * caller cannot decrypt a connection it does not own by guessing an id. A
 * connection belonging to someone else is reported as missing rather than
 * forbidden — whether a given uuid exists is not this caller's business.
 *
 * There is no environment fallback when decryption fails. An earlier version
 * returned `SIMPLEFIN_ACCESS_URL` in that case to survive an `ENCRYPTION_KEY`
 * rotation; with per-merchant connections that would serve one merchant's bank
 * feed to another whose credential happened to be undecryptable. Failing is
 * the only safe answer.
 */
async function getConnectionCredential(
  connectionId: string,
  merchantId: string,
): Promise<{ provider: string; credential: string; label: string | null }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_connections')
    .select('id, provider, label, access_url_encrypted')
    .eq('id', connectionId)
    .eq('merchant_id', merchantId)
    .single();

  if (error || !data) throw new Error('Finance connection not found');

  const provider = (data.provider as string) ?? 'simplefin';
  const key = requireEncryptionKey('finance connection access');
  try {
    return {
      provider,
      credential: decrypt(data.access_url_encrypted as string, key),
      label: (data.label as string | null) ?? null,
    };
  } catch (err) {
    // Both providers issue single-use link credentials, so neither can be
    // rotated in place — the only route back is a fresh link either way.
    const relink =
      provider === 'plaid' ? 'the connection must be linked again through Plaid' : 'the connection must be re-linked with a new setup token';
    throw new Error(
      `Stored ${provider} credential could not be decrypted (${
        err instanceof Error ? err.message : 'unknown error'
      }). ENCRYPTION_KEY may have changed; ${relink}.`,
    );
  }
}

/** Shape written to `finance_accounts`; omitted columns survive an update. */
function toAccountRow(connectionId: string, account: SimpleFinAccount, now: string) {
  const balance = parseAmount(account.balance);
  const org = account.org ?? {};
  const orgName = org.name ?? org.domain ?? null;

  return {
    connection_id: connectionId,
    external_id: account.id,
    org_id: org.id ?? null,
    org_name: orgName,
    org_domain: org.domain ?? null,
    org_url: org.url ?? org['sfin-url'] ?? null,
    name: account.name || 'Unnamed account',
    currency: (account.currency || 'USD').toUpperCase(),
    balance,
    available_balance: parseAmount(account['available-balance']),
    balance_date: unixToIso(account['balance-date']),
    // Re-derived every sync so a renamed account reclassifies itself.
    // `kind_override` is deliberately absent from this payload: it is the
    // operator's correction and must survive every re-derivation.
    kind: inferAccountKind(account.name, orgName, balance),
    last_seen_at: now,
  };
}

async function chunkedUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`Could not write ${table}: ${error.message}`);
  }
}

/**
 * Sync one connection.
 *
 * @param connectionId the connection to read
 * @param merchantId the owner; a connection belonging to anyone else is not found
 * @param days how far back to read transactions, clamped to SimpleFIN's 90-day window
 * @throws {Error} when the whole request fails; per-institution failures are
 *         reported in `errors` with status `partial` instead, because one
 *         bank being down should not discard the other seven.
 */
export async function syncConnection(
  connectionId: string,
  merchantId: string,
  { days = DEFAULT_SYNC_DAYS }: { days?: number } = {},
): Promise<SyncResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = Math.min(Math.max(Math.floor(days) || DEFAULT_SYNC_DAYS, 1), MAX_SYNC_DAYS);

  try {
    const { provider, credential, label } = await getConnectionCredential(connectionId, merchantId);
    const startDate = new Date(Date.now() - windowDays * 86_400_000);

    const set = await fetchAccountSetForProvider(provider, credential, {
      startDate,
      pending: true,
      orgName: label,
    });
    const reported = collectErrors(set);
    const errors = reported.filter((message) => !isAdvisory(message));
    const notices = reported.filter(isAdvisory);
    const now = new Date().toISOString();

    // --- accounts -----------------------------------------------------------
    const accountRows = set.accounts.map((a) => toAccountRow(connectionId, a, now));
    if (accountRows.length > 0) {
      await chunkedUpsert('finance_accounts', accountRows, 'connection_id,external_id');
    }

    // Map SimpleFIN account ids to our uuids for the transaction foreign key.
    const { data: stored, error: storedError } = await supabase
      .from('finance_accounts')
      .select('id, external_id')
      .eq('connection_id', connectionId);
    if (storedError) throw new Error(`Could not read finance accounts: ${storedError.message}`);

    const idByExternal = new Map<string, string>();
    for (const row of stored ?? []) idByExternal.set(row.external_id as string, row.id as string);

    // --- transactions -------------------------------------------------------
    const txRows: Record<string, unknown>[] = [];
    // Ids of pending rows that an incoming posted row replaces. Only providers
    // that re-id on posting populate this; see SimpleFinTransaction.supersedes.
    const supersededIds: string[] = [];
    for (const account of set.accounts) {
      const accountId = idByExternal.get(account.id);
      if (!accountId) continue;

      for (const tx of account.transactions ?? []) {
        const amount = parseAmount(tx.amount);
        const posted = unixToIso(tx.posted);
        // A row with no amount or no post date cannot be summed or ordered;
        // importing it would only corrupt totals.
        if (amount === null || !posted) continue;

        const mcc =
          tx.mcc === null || tx.mcc === undefined || tx.mcc === '' ? null : String(tx.mcc);

        if (tx.supersedes) supersededIds.push(tx.supersedes);

        txRows.push({
          account_id: accountId,
          external_id: tx.id,
          posted,
          transacted_at: unixToIso(tx.transacted_at),
          amount,
          description: tx.description ?? null,
          payee: tx.payee ?? null,
          memo: tx.memo ?? null,
          mcc,
          pending: tx.pending === true,
          category: categorizeTransaction({
            description: tx.description,
            payee: tx.payee,
            memo: tx.memo,
            mcc,
            amount,
          }),
          updated_at: now,
        });
      }
    }

    // Count genuinely new rows before writing, since an upsert cannot say
    // whether it inserted or updated.
    const transactionsNew = await countNewTransactions(
      txRows,
      [...idByExternal.values()],
      startDate.toISOString(),
    );

    if (txRows.length > 0) {
      await chunkedUpsert('finance_transactions', txRows, 'account_id,external_id');
    }

    // Drop the pending rows the posted ones just replaced. Done AFTER the
    // upsert so a failure mid-write leaves a duplicate — visible and fixed by
    // the next sync — rather than a hole where the charge has vanished
    // entirely. Chunked for the same reason countNewTransactions pages: a long
    // `in()` list becomes a URL long enough to fail as a bare `fetch failed`.
    if (supersededIds.length > 0) {
      const accountIds = [...idByExternal.values()];
      for (let i = 0; i < supersededIds.length; i += UPSERT_CHUNK) {
        const chunk = supersededIds.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase
          .from('finance_transactions')
          .delete()
          .in('account_id', accountIds)
          .in('external_id', chunk);
        if (error) throw new Error(`Could not clear superseded transactions: ${error.message}`);
      }
    }

    const status: SyncResult['status'] = errors.length > 0 ? 'partial' : 'ok';

    await supabase
      .from('finance_connections')
      .update({
        last_synced_at: now,
        last_sync_status: status,
        last_sync_error: errors.length > 0 ? errors.join('; ').slice(0, 2000) : null,
        last_sync_accounts: accountRows.length,
        last_sync_transactions: txRows.length,
      })
      .eq('id', connectionId)
      .eq('merchant_id', merchantId);

    return {
      connectionId,
      accounts: accountRows.length,
      transactionsSeen: txRows.length,
      transactionsNew,
      errors,
      notices,
      status,
    };
  } catch (err) {
    const message = redactAccessUrl(err instanceof Error ? err.message : 'Unknown sync failure');
    // Scoped by owner as well as id. This runs for *any* failure, including
    // "connection not found" — which is exactly what a caller passing someone
    // else's connection id gets. Without the merchant filter, that caller
    // would stamp an error onto a stranger's connection.
    await supabase
      .from('finance_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_error: message.slice(0, 2000),
      })
      .eq('id', connectionId)
      .eq('merchant_id', merchantId);
    throw new Error(message);
  }
}

/**
 * How many of these transactions we have never seen.
 *
 * Reads the external ids we already hold for these accounts over the same
 * window and diffs in memory. The obvious implementation — asking Postgres
 * `where external_id in (...)` — puts hundreds of 40-character ids into a
 * query string and the request dies as a bare `TypeError: fetch failed`, with
 * nothing to suggest the URL length was the problem. Paging a bounded window
 * keeps every request small regardless of how many transactions came back.
 */
async function countNewTransactions(
  rows: Record<string, unknown>[],
  accountIds: string[],
  sinceIso: string,
): Promise<number> {
  if (rows.length === 0 || accountIds.length === 0) return 0;
  const supabase = getSupabaseAdmin();

  const known = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('finance_transactions')
      .select('account_id, external_id')
      .in('account_id', accountIds)
      .gte('posted', sinceIso)
      .range(offset, offset + 999);

    if (error) throw new Error(`Could not count existing transactions: ${error.message}`);

    const page = data ?? [];
    for (const row of page) known.add(`${row.account_id}::${row.external_id}`);
    if (page.length < 1000) break;
  }

  let fresh = 0;
  for (const row of rows) {
    if (!known.has(`${row.account_id}::${row.external_id}`)) fresh += 1;
  }
  return fresh;
}

/** Sync every active connection belonging to one merchant. */
export async function syncAllConnections(
  merchantId: string,
  { days = DEFAULT_SYNC_DAYS }: { days?: number } = {},
): Promise<SyncResult[]> {
  const connections = (await listConnections(merchantId)).filter((c) => c.is_active);
  const results: SyncResult[] = [];

  // Sequential on purpose: SimpleFIN allows roughly 24 requests per day *per
  // connection*, and parallel requests would spend one merchant's budget in
  // bursts for no gain.
  for (const connection of connections) {
    results.push(await syncConnection(connection.id, merchantId, { days }));
  }

  return results;
}

/**
 * Unlink a connection and cascade away its accounts and transactions.
 *
 * Scoped by owner, so passing a stranger's id deletes nothing.
 */
export async function deleteConnection(connectionId: string, merchantId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Revoke upstream BEFORE dropping our row. Deleting first would destroy the
  // only copy of the token while Plaid still holds a live read feed into the
  // merchant's bank, with nothing left to revoke it with.
  //
  // SimpleFIN has no revoke endpoint — an access URL is disabled at the bridge
  // by its owner — so this applies to Plaid alone.
  let toRevoke: string | null = null;
  try {
    const { provider, credential } = await getConnectionCredential(connectionId, merchantId);
    if (provider === 'plaid') toRevoke = credential;
  } catch {
    // Missing row, or a credential we can no longer decrypt. Neither can be
    // revoked and neither should block the merchant from clearing the row.
  }

  if (toRevoke) {
    try {
      await removePlaidItem(toRevoke);
    } catch (err) {
      // An item already gone upstream is the outcome we wanted. Anything else
      // is a token still live at Plaid, so refuse rather than lose the handle.
      const code = (err as { code?: string })?.code;
      if (code !== 'ITEM_NOT_FOUND' && code !== 'INVALID_ACCESS_TOKEN') throw err;
    }
  }

  const { error } = await supabase
    .from('finance_connections')
    .delete()
    .eq('id', connectionId)
    .eq('merchant_id', merchantId);
  if (error) throw new Error(`Could not delete the connection: ${error.message}`);
}

/**
 * Re-derive categories over transactions already stored.
 *
 * Categorisation is a local function of fields we already hold, so improving
 * the rules should not cost a SimpleFIN request — the quota is ~24/day and
 * re-fetching 90 days to recompute a text match would be absurd. This reads the
 * merchant's own rows, recomputes, and writes back only the ones that changed.
 *
 * @returns how many rows were examined and how many actually moved
 */
export async function recategorizeStored(
  merchantId: string,
): Promise<{ examined: number; updated: number }> {
  const supabase = getSupabaseAdmin();

  const connectionIds = (await listConnections(merchantId)).map((c) => c.id);
  if (connectionIds.length === 0) return { examined: 0, updated: 0 };

  const { data: accounts, error: accountsError } = await supabase
    .from('finance_accounts')
    .select('id')
    .in('connection_id', connectionIds);
  if (accountsError) throw new Error(`Could not read accounts: ${accountsError.message}`);

  const accountIds = (accounts ?? []).map((a) => a.id as string);
  if (accountIds.length === 0) return { examined: 0, updated: 0 };

  let examined = 0;
  let updated = 0;

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('finance_transactions')
      .select('id, description, payee, memo, mcc, amount, category')
      .in('account_id', accountIds)
      .order('posted', { ascending: false })
      .range(offset, offset + 999);

    if (error) throw new Error(`Could not read transactions: ${error.message}`);

    const page = data ?? [];
    examined += page.length;

    for (const row of page) {
      const next = categorizeTransaction({
        description: row.description as string | null,
        payee: row.payee as string | null,
        memo: row.memo as string | null,
        mcc: row.mcc as string | null,
        amount: Number(row.amount),
      });

      if (next === (row.category ?? null)) continue;

      const { error: updateError } = await supabase
        .from('finance_transactions')
        .update({ category: next })
        .eq('id', row.id);
      if (updateError) throw new Error(`Could not update category: ${updateError.message}`);
      updated += 1;
    }

    if (page.length < 1000) break;
  }

  return { examined, updated };
}
