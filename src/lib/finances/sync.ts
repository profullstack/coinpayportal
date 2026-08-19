import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { encrypt, decrypt } from '../crypto/encryption';
import { requireEncryptionKey } from '../crypto/require-key';
import {
  fetchAccountSet,
  collectErrors,
  parseAmount,
  unixToIso,
  parseAccessUrl,
  redactAccessUrl,
  type SimpleFinAccount,
} from './simplefin';
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
async function getAccessUrl(connectionId: string, merchantId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_connections')
    .select('id, access_url_encrypted')
    .eq('id', connectionId)
    .eq('merchant_id', merchantId)
    .single();

  if (error || !data) throw new Error('Finance connection not found');

  const key = requireEncryptionKey('finance connection access');
  try {
    return decrypt(data.access_url_encrypted as string, key);
  } catch (err) {
    throw new Error(
      `Stored SimpleFIN credential could not be decrypted (${
        err instanceof Error ? err.message : 'unknown error'
      }). ENCRYPTION_KEY may have changed; the connection must be re-linked with a new setup token.`,
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
    const accessUrl = await getAccessUrl(connectionId, merchantId);
    const startDate = new Date(Date.now() - windowDays * 86_400_000);

    const set = await fetchAccountSet(accessUrl, { startDate, pending: true });
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
  const { error } = await supabase
    .from('finance_connections')
    .delete()
    .eq('id', connectionId)
    .eq('merchant_id', merchantId);
  if (error) throw new Error(`Could not delete the connection: ${error.message}`);
}
