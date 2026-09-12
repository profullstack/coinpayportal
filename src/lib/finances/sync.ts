import 'server-only';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../supabase/server';
import { encrypt, decrypt } from '../crypto/encryption';
import { requireEncryptionKey } from '../crypto/require-key';
import {
  collectProviderErrors,
  parseAmount,
  unixToIso,
  parseAccessUrl,
  redactAccessUrl,
  ProviderRequestError,
  type ProviderError,
  type SimpleFinAccount,
  type SimpleFinAccountSet,
  type SimpleFinProtocolVersion,
} from './simplefin';
import { fetchAccountSetForProvider } from './provider';
import { removePlaidItem } from './plaid';
import { inferAccountKind, categorizeTransaction } from './classify';
import { parseExactAmount, normalizeCurrency, type ExactAmount } from './decimal';
import { checkRequestBudget, recordRequestUsage, BudgetExhaustedError, type RequestClass } from './budget';

/**
 * Pulling a provider's account set into Postgres.
 *
 * Two callers share one ingestion path: the rolling `syncConnection` an
 * operator triggers from the page or the CLI, and the period backfill jobs in
 * `./jobs.ts`. Both hand `ingestAccountSet` a fetched set plus the window it
 * was fetched for, and it records what it stored *and* what it was asked for
 * — the difference between those is what a report later calls coverage.
 *
 * Everything is idempotent by construction: sources key on
 * `(connection_id, namespace, upstream_id)`, accounts on
 * `(source_connection_id, external_id)` and transactions on
 * `(account_id, external_id)`, so re-reading a window changes nothing but
 * `updated_at` — unless the provider changed a row, in which case the prior
 * values go to `finance_transaction_revisions` and the revision counter moves.
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
const ADVISORY_PATTERNS = [/exceeds (the )?recommended range/i, /and was capped/i];

export function isAdvisory(message: string): boolean {
  return ADVISORY_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * An advisory that says the bridge returned LESS than was asked for. Still
 * not an institution failure — but for a period report it is a coverage
 * fact: the window was not fully fetched, whatever data came back.
 */
export function isCapNotice(message: string): boolean {
  return /and was capped/i.test(message);
}

/** PostgREST rejects very large payloads; upserts go up in chunks of this size. */
const UPSERT_CHUNK = 500;

export interface SyncResult {
  connectionId: string;
  accounts: number;
  transactionsSeen: number;
  transactionsNew: number;
  /** Institution-level failures the provider reported without failing the request. */
  errors: string[];
  /** Advisories from the bridge — informational, and not a failure. */
  notices: string[];
  status: 'ok' | 'partial';
  /** Structured form of `errors`, with the source/account each one is about. */
  providerErrors: ProviderError[];
  /** Posted rows dropped for lacking a valid amount or date. */
  transactionsRejected: number;
  /** Rows whose values changed since they were last stored. */
  transactionsRevised: number;
  /** The bridge returned a shorter range than requested. */
  capped: boolean;
  /** Accounts whose upstream identity could not be resolved without guessing. */
  identityReviewRequired: number;
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
  protocol_version: number | null;
  sync_consent_at: string | null;
  next_sync_at: string | null;
  lifecycle_state: string;
  disconnected_at: string | null;
}

/** Columns safe to return to a client — never the encrypted access URL. */
const CONNECTION_COLUMNS =
  'id, provider, label, is_active, created_at, last_synced_at, last_sync_status, last_sync_error, last_sync_accounts, last_sync_transactions, protocol_version, sync_consent_at, next_sync_at, lifecycle_state, disconnected_at';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** A minute of the day chosen once per credential, so daily syncs spread out. */
function randomSyncMinute(): number {
  return Math.floor(Math.random() * 1440);
}

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
  protocolVersion?: SimpleFinProtocolVersion;
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
      protocol_version: params.protocolVersion ?? null,
      sync_minute: randomSyncMinute(),
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
      sync_minute: randomSyncMinute(),
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

export async function getConnection(
  connectionId: string,
  merchantId: string,
): Promise<FinanceConnectionRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_connections')
    .select(CONNECTION_COLUMNS)
    .eq('id', connectionId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the connection: ${error.message}`);
  return (data as FinanceConnectionRow | null) ?? null;
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
): Promise<{
  provider: string;
  credential: string;
  label: string | null;
  protocolVersion: SimpleFinProtocolVersion | undefined;
  lifecycleState: string;
}> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_connections')
    .select('id, provider, label, access_url_encrypted, protocol_version, lifecycle_state')
    .eq('id', connectionId)
    .eq('merchant_id', merchantId)
    .single();

  if (error || !data) throw new Error('Finance connection not found');
  if (data.lifecycle_state === 'disconnected' || !data.access_url_encrypted) {
    throw new Error('This connection has been disconnected; link it again to fetch new data');
  }

  const provider = (data.provider as string) ?? 'simplefin';
  const key = requireEncryptionKey('finance connection access');
  try {
    return {
      provider,
      credential: decrypt(data.access_url_encrypted as string, key),
      label: (data.label as string | null) ?? null,
      protocolVersion: (data.protocol_version as SimpleFinProtocolVersion | null) ?? undefined,
      lifecycleState: (data.lifecycle_state as string) ?? 'active',
    };
  } catch (err) {
    // Both providers issue single-use link credentials, so neither can be
    // rotated in place — the only route back is a fresh link either way.
    const relink =
      provider === 'plaid'
        ? 'the connection must be linked again through Plaid'
        : 'the connection must be re-linked with a new setup token';
    throw new Error(
      `Stored ${provider} credential could not be decrypted (${
        err instanceof Error ? err.message : 'unknown error'
      }). ENCRYPTION_KEY may have changed; ${relink}.`,
    );
  }
}

/**
 * Fetch a connection's account set for a window, owner-scoped.
 *
 * The request is counted against the credential's budget before it is sent,
 * so a request that fails still costs what it cost the provider.
 */
export async function fetchForConnection(
  connectionId: string,
  merchantId: string,
  window: { start: Date; end?: Date; requestClass?: RequestClass; jobId?: string | null },
): Promise<{ set: SimpleFinAccountSet; provider: string; label: string | null }> {
  const { provider, credential, label, protocolVersion } = await getConnectionCredential(
    connectionId,
    merchantId,
  );
  await recordRequestUsage(connectionId, window.requestClass ?? 'interactive', window.jobId ?? null);
  const set = await fetchAccountSetForProvider(provider, credential, {
    startDate: window.start,
    endDate: window.end,
    pending: true,
    orgName: label,
    version: protocolVersion,
  });
  return { set, provider, label };
}

/** Shape written to `finance_accounts`; omitted columns survive an update. */
function toAccountRow(
  connectionId: string,
  sourceConnectionId: string,
  account: SimpleFinAccount,
  now: string,
) {
  const balanceText = parseExactAmount(account.balance);
  const balanceNumber = parseAmount(account.balance);
  const org = account.org ?? {};
  const orgName = org.name ?? org.domain ?? null;

  return {
    connection_id: connectionId,
    source_connection_id: sourceConnectionId,
    external_id: account.id,
    org_id: org.id ?? null,
    org_name: orgName,
    org_domain: org.domain ?? null,
    org_url: org.url ?? org['sfin-url'] ?? null,
    name: account.name || 'Unnamed account',
    currency: normalizeCurrency(account.currency),
    balance: balanceText,
    available_balance: parseExactAmount(account['available-balance']),
    balance_date: unixToIso(account['balance-date']),
    // Re-derived every sync so a renamed account reclassifies itself.
    // `kind_override` is deliberately absent from this payload: it is the
    // operator's correction and must survive every re-derivation.
    kind: inferAccountKind(account.name, orgName, balanceNumber),
    last_seen_at: now,
  };
}

async function chunkedUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  options: { ignoreDuplicates?: boolean } = {},
): Promise<void> {
  const supabase = getSupabaseAdmin();
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict, ignoreDuplicates: options.ignoreDuplicates ?? false });
    if (error) throw new Error(`Could not write ${table}: ${error.message}`);
  }
}

/** Which upstream source an account belongs to, by provider and protocol. */
function sourceKeyFor(
  provider: string,
  connectionId: string,
  account: SimpleFinAccount,
): { namespace: 'legacy' | 'simplefin_v2' | 'plaid'; upstreamId: string } {
  if (provider === 'plaid') return { namespace: 'plaid', upstreamId: connectionId };
  if (typeof account.conn_id === 'string' && account.conn_id.trim()) {
    return { namespace: 'simplefin_v2', upstreamId: account.conn_id.trim() };
  }
  return { namespace: 'legacy', upstreamId: connectionId };
}

/** What a stored transaction's content hash is computed over. */
function transactionContent(row: {
  posted: string | null;
  transacted_at: string | null;
  amount: ExactAmount;
  description: string | null;
  payee: string | null;
  memo: string | null;
  mcc: string | null;
  pending: boolean;
}): string {
  return sha256(
    JSON.stringify([
      row.posted,
      row.transacted_at,
      row.amount,
      row.description,
      row.payee,
      row.memo,
      row.mcc,
      row.pending,
    ]),
  );
}

export interface IngestWindow {
  start: Date;
  /** Exclusive. Defaults to the moment of ingestion. */
  end?: Date;
}

export interface IngestOptions {
  connectionId: string;
  merchantId: string;
  provider: string;
  set: SimpleFinAccountSet;
  window: IngestWindow;
  jobId?: string | null;
  requestClass: 'interactive' | 'background';
}

/**
 * Store a fetched account set and record what the fetch covered.
 *
 * @throws {Error} only for storage failures; provider-reported errors are
 *         returned in the result, scoped to the source or account they name.
 */
export async function ingestAccountSet(options: IngestOptions): Promise<SyncResult> {
  const { connectionId, merchantId, provider, set, jobId = null } = options;
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const windowStart = options.window.start.toISOString();
  const windowEnd = (options.window.end ?? new Date()).toISOString();

  const providerErrors = collectProviderErrors(set);
  const errors = providerErrors.filter((e) => !isAdvisory(e.message));
  const notices = providerErrors.filter((e) => isAdvisory(e.message)).map((e) => e.message);
  const capped = notices.some(isCapNotice);

  // --- sources --------------------------------------------------------------
  const upstreamMeta = new Map<string, { name?: string; org_id?: string; org_url?: string; sfin_url?: string }>();
  for (const c of set.connections ?? []) {
    if (c && typeof c.conn_id === 'string') upstreamMeta.set(c.conn_id, c);
  }

  const sourceKeys = new Map<string, { namespace: string; upstreamId: string }>();
  for (const account of set.accounts) {
    const key = sourceKeyFor(provider, connectionId, account);
    sourceKeys.set(`${key.namespace}::${key.upstreamId}`, key);
  }
  // A failed source that returned no accounts still needs a row so its state
  // can be recorded and shown.
  for (const e of errors) {
    if (e.connId) sourceKeys.set(`simplefin_v2::${e.connId}`, { namespace: 'simplefin_v2', upstreamId: e.connId });
  }

  const sourceRows = [...sourceKeys.values()].map(({ namespace, upstreamId }) => {
    const meta = namespace === 'simplefin_v2' ? upstreamMeta.get(upstreamId) : undefined;
    return {
      connection_id: connectionId,
      merchant_id: merchantId,
      namespace,
      upstream_id: upstreamId,
      name: meta?.name ?? null,
      org_id: meta?.org_id ?? null,
      org_url: meta?.org_url ?? null,
      sfin_url: meta?.sfin_url ?? null,
      last_seen_at: now,
    };
  });
  if (sourceRows.length > 0) {
    await chunkedUpsert('finance_source_connections', sourceRows, 'connection_id,namespace,upstream_id');
  }

  const { data: storedSources, error: sourcesError } = await supabase
    .from('finance_source_connections')
    .select('id, namespace, upstream_id')
    .eq('connection_id', connectionId)
    .eq('merchant_id', merchantId);
  if (sourcesError) throw new Error(`Could not read finance sources: ${sourcesError.message}`);

  const sourceIdByKey = new Map<string, string>();
  let legacySourceId: string | null = null;
  for (const row of storedSources ?? []) {
    sourceIdByKey.set(`${row.namespace}::${row.upstream_id}`, row.id as string);
    if (row.namespace === 'legacy') legacySourceId = row.id as string;
  }

  // Per-source outcome from the structured errors.
  const sourceState = new Map<string, { state: string; code: string | null; message: string | null }>();
  for (const e of errors) {
    if (!e.connId) continue;
    const id = sourceIdByKey.get(`simplefin_v2::${e.connId}`);
    if (!id) continue;
    const state = /auth/i.test(e.code) ? 'reconnect_required' : 'failed';
    sourceState.set(id, { state, code: e.code, message: e.message.slice(0, 500) });
  }
  for (const [id, s] of sourceState) {
    await supabase
      .from('finance_source_connections')
      .update({ state: s.state, last_error_code: s.code, last_error: s.message })
      .eq('id', id)
      .eq('merchant_id', merchantId);
  }
  // Sources that answered cleanly are back to ok.
  const healthySourceIds = [...sourceIdByKey.values()].filter((id) => !sourceState.has(id));
  if (healthySourceIds.length > 0 && set.accounts.length > 0) {
    await supabase
      .from('finance_source_connections')
      .update({ state: 'ok', last_error_code: null, last_error: null })
      .in('id', healthySourceIds)
      .eq('merchant_id', merchantId);
  }

  // --- identity upgrade: legacy accounts meeting their v2 identity ---------
  // An account first imported under the legacy source and now reported with
  // a conn_id is the same account when exactly one incoming account carries
  // that external id. Move it in place so its uuid and every transaction
  // foreign key survive. Two incoming accounts sharing the id is exactly the
  // collision the namespace exists for: the legacy row is flagged for review
  // and both new identities are stored separately. Nothing is merged by name.
  let identityReviewRequired = 0;
  if (legacySourceId) {
    const incomingV2 = set.accounts.filter((a) => sourceKeyFor(provider, connectionId, a).namespace === 'simplefin_v2');
    if (incomingV2.length > 0) {
      const { data: legacyAccounts, error: legacyError } = await supabase
        .from('finance_accounts')
        .select('id, external_id, identity_state')
        .eq('source_connection_id', legacySourceId);
      if (legacyError) throw new Error(`Could not read legacy accounts: ${legacyError.message}`);

      const byExternal = new Map<string, SimpleFinAccount[]>();
      for (const a of incomingV2) {
        const list = byExternal.get(a.id) ?? [];
        list.push(a);
        byExternal.set(a.id, list);
      }

      for (const legacy of legacyAccounts ?? []) {
        const candidates = byExternal.get(legacy.external_id as string);
        if (!candidates || candidates.length === 0) continue;
        if (candidates.length === 1) {
          const key = sourceKeyFor(provider, connectionId, candidates[0]);
          const targetSource = sourceIdByKey.get(`${key.namespace}::${key.upstreamId}`);
          if (!targetSource) continue;
          // Only if that identity is not already occupied by another row.
          const { count } = await supabase
            .from('finance_accounts')
            .select('id', { count: 'exact', head: true })
            .eq('source_connection_id', targetSource)
            .eq('external_id', legacy.external_id as string);
          if ((count ?? 0) === 0) {
            const { error: moveError } = await supabase
              .from('finance_accounts')
              .update({ source_connection_id: targetSource, identity_state: 'ok' })
              .eq('id', legacy.id as string)
              .eq('source_connection_id', legacySourceId);
            if (moveError) throw new Error(`Could not upgrade account identity: ${moveError.message}`);
          }
        } else {
          identityReviewRequired += 1;
          if (legacy.identity_state !== 'identity_review_required') {
            await supabase
              .from('finance_accounts')
              .update({ identity_state: 'identity_review_required' })
              .eq('id', legacy.id as string);
          }
        }
      }
    }
  }

  // --- accounts -------------------------------------------------------------
  const accountRows = set.accounts.map((a) => {
    const key = sourceKeyFor(provider, connectionId, a);
    const sourceId = sourceIdByKey.get(`${key.namespace}::${key.upstreamId}`);
    if (!sourceId) throw new Error('Finance source row missing after upsert');
    return toAccountRow(connectionId, sourceId, a, now);
  });
  if (accountRows.length > 0) {
    await chunkedUpsert('finance_accounts', accountRows, 'source_connection_id,external_id');
  }

  const { data: stored, error: storedError } = await supabase
    .from('finance_accounts')
    .select('id, external_id, source_connection_id, currency')
    .eq('connection_id', connectionId);
  if (storedError) throw new Error(`Could not read finance accounts: ${storedError.message}`);

  const idByIdentity = new Map<string, string>();
  for (const row of stored ?? []) {
    idByIdentity.set(`${row.source_connection_id}::${row.external_id}`, row.id as string);
  }
  const accountIdFor = (a: SimpleFinAccount): string | undefined => {
    const key = sourceKeyFor(provider, connectionId, a);
    const sourceId = sourceIdByKey.get(`${key.namespace}::${key.upstreamId}`);
    return sourceId ? idByIdentity.get(`${sourceId}::${a.id}`) : undefined;
  };

  // --- balance snapshots ----------------------------------------------------
  const snapshotRows: Record<string, unknown>[] = [];
  for (const account of set.accounts) {
    const accountId = accountIdFor(account);
    if (!accountId) continue;
    const currency = normalizeCurrency(account.currency);
    const balance = parseExactAmount(account.balance);
    const available = parseExactAmount(account['available-balance']);
    const providerAt = unixToIso(account['balance-date']);
    snapshotRows.push({
      account_id: accountId,
      currency,
      balance,
      available_balance: available,
      provider_balance_at: providerAt,
      observed_at: now,
      content_hash: sha256(JSON.stringify([currency, balance, available, providerAt])),
    });
  }
  if (snapshotRows.length > 0) {
    await chunkedUpsert('finance_balance_snapshots', snapshotRows, 'account_id,content_hash', {
      ignoreDuplicates: true,
    });
  }

  // --- transactions ---------------------------------------------------------
  const txRows: Record<string, unknown>[] = [];
  const supersededIds: string[] = [];
  const perAccount = new Map<string, { returned: number; rejected: number; first: string | null; last: string | null; warnings: string[] }>();
  let transactionsRejected = 0;

  for (const account of set.accounts) {
    const accountId = accountIdFor(account);
    if (!accountId) continue;
    const stats = { returned: 0, rejected: 0, first: null as string | null, last: null as string | null, warnings: [] as string[] };
    perAccount.set(accountId, stats);

    for (const tx of account.transactions ?? []) {
      stats.returned += 1;
      const amount = parseExactAmount(tx.amount);
      const posted = unixToIso(tx.posted);
      const pending = tx.pending === true || (!posted && tx.posted !== undefined && Number(tx.posted) === 0);

      if (amount === null) {
        // Never zero, never guessed: an amount we cannot represent exactly is
        // a row we cannot report on. Counted, not stored.
        stats.rejected += 1;
        transactionsRejected += 1;
        if (stats.warnings.length < 5) stats.warnings.push(`transaction ${String(tx.id).slice(0, 12)} has an unusable amount`);
        continue;
      }
      if (!posted && !pending) {
        stats.rejected += 1;
        transactionsRejected += 1;
        if (stats.warnings.length < 5) stats.warnings.push(`transaction ${String(tx.id).slice(0, 12)} is posted without a date`);
        continue;
      }

      const mcc = tx.mcc === null || tx.mcc === undefined || tx.mcc === '' ? null : String(tx.mcc);
      if (tx.supersedes) supersededIds.push(tx.supersedes);

      const content = {
        posted: pending && !posted ? null : posted,
        transacted_at: unixToIso(tx.transacted_at),
        amount,
        description: tx.description ?? null,
        payee: tx.payee ?? null,
        memo: tx.memo ?? null,
        mcc,
        pending,
      };
      if (posted) {
        if (!stats.first || posted < stats.first) stats.first = posted;
        if (!stats.last || posted > stats.last) stats.last = posted;
      }

      txRows.push({
        account_id: accountId,
        external_id: tx.id,
        ...content,
        category: categorizeTransaction({
          description: tx.description,
          payee: tx.payee,
          memo: tx.memo,
          mcc,
          amount: Number(amount),
        }),
        source_hash: transactionContent(content),
        updated_at: now,
      });
    }
  }

  const existing = await readExisting(
    [...perAccount.keys()],
    txRows.map((r) => r.external_id as string),
  );

  let transactionsNew = 0;
  let transactionsRevised = 0;
  const revisionRows: Record<string, unknown>[] = [];
  const rowsToWrite: Record<string, unknown>[] = [];
  for (const row of txRows) {
    const prior = existing.get(`${row.account_id}::${row.external_id}`);
    if (!prior) {
      transactionsNew += 1;
      rowsToWrite.push({ ...row, revision: 1 });
      continue;
    }
    if (prior.source_hash === row.source_hash) {
      // Unchanged replay: leave the row alone entirely, including its
      // category (which the operator may have corrected) and its revision.
      continue;
    }
    // Changed. The category stays as stored — a corrected category must
    // survive a provider edit to the description.
    const revision = (prior.revision ?? 1) + 1;
    transactionsRevised += 1;
    const { category: _ignored, ...withoutCategory } = row;
    void _ignored;
    rowsToWrite.push({ ...withoutCategory, revision, category: prior.category ?? row.category });
    revisionRows.push({
      transaction_id: prior.id,
      revision,
      observed_at: now,
      prior: {
        posted: prior.posted,
        transacted_at: prior.transacted_at,
        amount: prior.amount,
        description: prior.description,
        payee: prior.payee,
        memo: prior.memo,
        mcc: prior.mcc,
        pending: prior.pending,
      },
      current: {
        posted: row.posted,
        transacted_at: row.transacted_at,
        amount: row.amount,
        description: row.description,
        payee: row.payee,
        memo: row.memo,
        mcc: row.mcc,
        pending: row.pending,
      },
    });
  }

  if (rowsToWrite.length > 0) {
    await chunkedUpsert('finance_transactions', rowsToWrite, 'account_id,external_id');
  }
  if (revisionRows.length > 0) {
    await chunkedUpsert('finance_transaction_revisions', revisionRows, 'transaction_id,revision', {
      ignoreDuplicates: true,
    });
  }

  // Mark the pending rows the posted ones just replaced. Done AFTER the
  // upsert so a failure mid-write leaves a visible duplicate rather than a
  // hole. The pending row is kept and marked rather than deleted: it is
  // evidence of the pending item, and the report's posted ledger excludes
  // it either way.
  if (supersededIds.length > 0) {
    const accountIds = [...perAccount.keys()];
    for (let i = 0; i < supersededIds.length; i += UPSERT_CHUNK) {
      const chunk = supersededIds.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from('finance_transactions')
        .delete()
        .in('account_id', accountIds)
        .in('external_id', chunk)
        .eq('pending', true);
      if (error) throw new Error(`Could not clear superseded transactions: ${error.message}`);
    }
  }

  // --- what this fetch covered ---------------------------------------------
  const status: SyncResult['status'] = errors.length > 0 ? 'partial' : 'ok';
  const windowRows: Record<string, unknown>[] = [
    {
      job_id: jobId,
      connection_id: connectionId,
      source_connection_id: null,
      account_id: null,
      requested_start: windowStart,
      requested_end: windowEnd,
      rows_returned: txRows.length,
      rows_rejected: transactionsRejected,
      capped,
      warnings: [...errors.map((e) => e.message), ...notices].slice(0, 20),
      outcome: errors.length > 0 ? 'partial' : 'fetched',
      fetched_at: now,
    },
  ];
  for (const account of set.accounts) {
    const accountId = accountIdFor(account);
    if (!accountId) continue;
    const key = sourceKeyFor(provider, connectionId, account);
    const sourceId = sourceIdByKey.get(`${key.namespace}::${key.upstreamId}`) ?? null;
    const stats = perAccount.get(accountId);
    const sourceFailed = sourceId ? sourceState.has(sourceId) : false;
    const accountErrors = errors.filter((e) => e.accountId === account.id);
    windowRows.push({
      job_id: jobId,
      connection_id: connectionId,
      source_connection_id: sourceId,
      account_id: accountId,
      requested_start: windowStart,
      requested_end: windowEnd,
      observed_first_posted: stats?.first ?? null,
      observed_last_posted: stats?.last ?? null,
      rows_returned: stats?.returned ?? 0,
      rows_rejected: stats?.rejected ?? 0,
      capped,
      warnings: [...(stats?.warnings ?? []), ...accountErrors.map((e) => e.message)].slice(0, 20),
      outcome: sourceFailed || accountErrors.length > 0 ? 'partial' : 'fetched',
      fetched_at: now,
    });
  }
  const { error: windowError } = await supabase.from('finance_fetch_windows').insert(windowRows);
  if (windowError) throw new Error(`Could not record fetch coverage: ${windowError.message}`);

  return {
    connectionId,
    accounts: accountRows.length,
    transactionsSeen: txRows.length,
    transactionsNew,
    errors: errors.map((e) => e.message),
    notices,
    status,
    providerErrors: errors,
    transactionsRejected,
    transactionsRevised,
    capped,
    identityReviewRequired,
  };
}

interface ExistingTransaction {
  id: string;
  posted: string | null;
  transacted_at: string | null;
  amount: string;
  description: string | null;
  payee: string | null;
  memo: string | null;
  mcc: string | null;
  pending: boolean;
  category: string | null;
  source_hash: string | null;
  revision: number | null;
}

/**
 * The rows we already hold for these accounts and external ids.
 *
 * The obvious query — `where external_id in (...)` — puts hundreds of
 * 40-character ids into a URL and dies as a bare `TypeError: fetch failed`.
 * So this pages by account instead and diffs in memory.
 */
async function readExisting(
  accountIds: string[],
  externalIds: string[],
): Promise<Map<string, ExistingTransaction>> {
  const out = new Map<string, ExistingTransaction>();
  if (accountIds.length === 0 || externalIds.length === 0) return out;
  const wanted = new Set(externalIds);
  const supabase = getSupabaseAdmin();

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('finance_transactions')
      .select(
        'id, account_id, external_id, posted, transacted_at, amount, description, payee, memo, mcc, pending, category, source_hash, revision',
      )
      .in('account_id', accountIds)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Could not read existing transactions: ${error.message}`);
    const page = data ?? [];
    for (const row of page) {
      if (!wanted.has(row.external_id as string)) continue;
      out.set(`${row.account_id}::${row.external_id}`, {
        id: row.id as string,
        posted: (row.posted as string | null) ?? null,
        transacted_at: (row.transacted_at as string | null) ?? null,
        amount: parseExactAmount(row.amount) ?? String(row.amount),
        description: (row.description as string | null) ?? null,
        payee: (row.payee as string | null) ?? null,
        memo: (row.memo as string | null) ?? null,
        mcc: (row.mcc as string | null) ?? null,
        pending: row.pending === true,
        category: (row.category as string | null) ?? null,
        source_hash: (row.source_hash as string | null) ?? null,
        revision: (row.revision as number | null) ?? null,
      });
    }
    if (page.length < 1000) break;
  }

  // Rows stored before hashes existed compare by content, once.
  for (const row of out.values()) {
    if (!row.source_hash) {
      row.source_hash = transactionContent({
        posted: row.posted,
        transacted_at: row.transacted_at,
        amount: row.amount,
        description: row.description,
        payee: row.payee,
        memo: row.memo,
        mcc: row.mcc,
        pending: row.pending,
      });
    }
  }
  return out;
}

/** Stamp a provider outcome onto the connection row, owner-scoped. */
async function recordConnectionOutcome(
  connectionId: string,
  merchantId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from('finance_connections')
    .update(patch)
    .eq('id', connectionId)
    .eq('merchant_id', merchantId);
}

/** Lifecycle state a provider error code implies, if any. */
export function lifecycleStateFor(err: unknown): 'reconnect_required' | 'payment_required' | null {
  if (err instanceof ProviderRequestError) {
    if (err.code === 'provider_reconnect_required') return 'reconnect_required';
    if (err.code === 'provider_payment_required') return 'payment_required';
  }
  return null;
}

/**
 * Sync one connection over a rolling window.
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
  { days = DEFAULT_SYNC_DAYS, jobId = null, requestClass = 'interactive' }: { days?: number; jobId?: string | null; requestClass?: 'interactive' | 'background' } = {},
): Promise<SyncResult> {
  const windowDays = Math.min(Math.max(Math.floor(days) || DEFAULT_SYNC_DAYS, 1), MAX_SYNC_DAYS);

  try {
    const startDate = new Date(Date.now() - windowDays * 86_400_000);
    const endDate = new Date();

    const existing = await getConnection(connectionId, merchantId);
    if (!existing) throw new Error('Finance connection not found');
    const budget = await checkRequestBudget(connectionId, requestClass, endDate);
    if (!budget.allowed) throw new BudgetExhaustedError(budget);

    const fetched = await fetchForConnection(connectionId, merchantId, {
      start: startDate,
      requestClass,
      jobId,
    });

    const result = await ingestAccountSet({
      connectionId,
      merchantId,
      provider: fetched.provider,
      set: fetched.set,
      window: { start: startDate, end: endDate },
      jobId,
      requestClass,
    });

    await recordConnectionOutcome(connectionId, merchantId, {
      last_synced_at: endDate.toISOString(),
      last_sync_status: result.status,
      last_sync_error: result.errors.length > 0 ? result.errors.join('; ').slice(0, 2000) : null,
      last_sync_accounts: result.accounts,
      last_sync_transactions: result.transactionsSeen,
      lifecycle_state: 'active',
    });

    return result;
  } catch (err) {
    const message = redactAccessUrl(err instanceof Error ? err.message : 'Unknown sync failure');
    // Scoped by owner as well as id. This runs for *any* failure, including
    // "connection not found" — which is exactly what a caller passing someone
    // else's connection id gets. Without the merchant filter, that caller
    // would stamp an error onto a stranger's connection.
    const lifecycle = lifecycleStateFor(err);
    await recordConnectionOutcome(connectionId, merchantId, {
      last_synced_at: new Date().toISOString(),
      last_sync_status: 'error',
      last_sync_error: message.slice(0, 2000),
      ...(lifecycle ? { lifecycle_state: lifecycle } : {}),
    });
    if (err instanceof BudgetExhaustedError) throw err;
    const wrapped = new Error(message);
    if (err instanceof ProviderRequestError) (wrapped as Error & { code?: string }).code = err.code;
    throw wrapped;
  }
}

/** Sync every active connection belonging to one merchant. */
export async function syncAllConnections(
  merchantId: string,
  { days = DEFAULT_SYNC_DAYS }: { days?: number } = {},
): Promise<SyncResult[]> {
  const connections = (await listConnections(merchantId)).filter(
    (c) => c.is_active && c.lifecycle_state !== 'disconnected',
  );
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
 * Stop future work and remove the usable credential, keeping history.
 *
 * This is the "disconnect" of the two distinct actions: accounts,
 * transactions, reports and statements all stay. `deleteConnection` below is
 * the destructive one.
 */
export async function disconnectConnection(connectionId: string, merchantId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await revokeUpstream(connectionId, merchantId);

  const { data, error } = await supabase
    .from('finance_connections')
    .update({
      access_url_encrypted: '',
      is_active: false,
      lifecycle_state: 'disconnected',
      disconnected_at: new Date().toISOString(),
      sync_consent_at: null,
      next_sync_at: null,
    })
    .eq('id', connectionId)
    .eq('merchant_id', merchantId)
    .select('id');
  if (error) throw new Error(`Could not disconnect the connection: ${error.message}`);
  if (!data || data.length === 0) throw new Error('Finance connection not found');

  await supabase
    .from('finance_jobs')
    .update({ cancel_requested: true, updated_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('merchant_id', merchantId)
    .in('status', ['queued', 'waiting_for_budget', 'running']);
}

async function revokeUpstream(connectionId: string, merchantId: string): Promise<void> {
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
}

/**
 * What deleting a connection would take with it. Reports keep their frozen
 * datasets (they do not reference accounts by foreign key) but statements
 * and reconciliations cascade from the accounts.
 */
export async function describeConnectionDeletion(
  connectionId: string,
  merchantId: string,
): Promise<{ accounts: number; transactions: number; statements: number; reports: number }> {
  const supabase = getSupabaseAdmin();
  const conn = await getConnection(connectionId, merchantId);
  if (!conn) throw new Error('Finance connection not found');

  const { data: accounts } = await supabase
    .from('finance_accounts')
    .select('id')
    .eq('connection_id', connectionId);
  const accountIds = (accounts ?? []).map((a) => a.id as string);
  if (accountIds.length === 0) return { accounts: 0, transactions: 0, statements: 0, reports: 0 };

  const { count: transactions } = await supabase
    .from('finance_transactions')
    .select('id', { count: 'exact', head: true })
    .in('account_id', accountIds);
  const { count: statements } = await supabase
    .from('finance_statements')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId)
    .in('account_id', accountIds)
    .eq('state', 'active');
  const { count: reports } = await supabase
    .from('finance_reports')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId)
    .overlaps('account_ids', accountIds)
    .neq('status', 'deleted');

  return {
    accounts: accountIds.length,
    transactions: transactions ?? 0,
    statements: statements ?? 0,
    reports: reports ?? 0,
  };
}

/**
 * Unlink a connection and cascade away its accounts and transactions.
 *
 * Scoped by owner, so passing a stranger's id deletes nothing. Callers must
 * have shown the merchant `describeConnectionDeletion` first.
 */
export async function deleteConnection(connectionId: string, merchantId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await revokeUpstream(connectionId, merchantId);

  const { error } = await supabase
    .from('finance_connections')
    .delete()
    .eq('id', connectionId)
    .eq('merchant_id', merchantId);
  if (error) throw new Error(`Could not delete the connection: ${error.message}`);
}

/** Record or withdraw consent to a daily background sync. */
export async function setSyncConsent(
  connectionId: string,
  merchantId: string,
  consent: boolean,
): Promise<FinanceConnectionRow> {
  const supabase = getSupabaseAdmin();
  const conn = await getConnection(connectionId, merchantId);
  if (!conn) throw new Error('Finance connection not found');
  const now = new Date();
  const minute = randomSyncMinute();
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCMinutes(minute);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  const { data, error } = await supabase
    .from('finance_connections')
    .update(
      consent
        ? { sync_consent_at: now.toISOString(), sync_minute: minute, next_sync_at: next.toISOString() }
        : { sync_consent_at: null, next_sync_at: null },
    )
    .eq('id', connectionId)
    .eq('merchant_id', merchantId)
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) throw new Error(`Could not update sync consent: ${error.message}`);
  return data as FinanceConnectionRow;
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
