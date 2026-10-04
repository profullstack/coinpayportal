import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { getSupabaseAdmin } from '../supabase/server';
import { requireEncryptionKey } from '../crypto/require-key';
import { putObject, getObject, deleteObject } from './files';
import { auditFinance } from './audit';

/**
 * A bank session CoinPay keeps for a merchant, the way an aggregator keeps a
 * connection: what the bank's own site issued after the merchant signed in
 * (its cookies, and the site storage of the page they finished on), never a
 * password. Plaid keeps an access token per Item; this keeps the browser
 * state the bank itself uses to recognise a returning device.
 *
 * Two layers of encryption: the state is sealed with a key used for nothing
 * else (FINANCES_BANK_SESSION_KEY, or HKDF over ENCRYPTION_KEY with its own
 * label), then stored through the files volume, which seals it again with the
 * document key. A leaked statement key alone opens no bank session.
 */

export interface SavedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  priority?: string;
  sourceScheme?: string;
  sourcePort?: number;
  partitionKey?: unknown;
}

export interface SessionState {
  version: 1;
  savedAt: string;
  userAgent: string | null;
  cookies: SavedCookie[];
  /** localStorage per origin, as [key, value] pairs. */
  storage: Record<string, [string, string][]>;
}

export interface BankSessionRow {
  id: string;
  merchant_id: string;
  institution_key: string;
  institution_label: string | null;
  start_url: string | null;
  object_key: string | null;
  state: 'pending' | 'active' | 'login_needed' | 'disconnected';
  cookie_count: number;
  seen_keys: string[];
  schedule: 'weekly' | 'off';
  next_fetch_at: string | null;
  last_login_at: string | null;
  last_fetch_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, merchant_id, institution_key, institution_label, start_url, object_key, state, cookie_count, seen_keys, schedule, next_fetch_at, last_login_at, last_fetch_at, last_status, created_at, updated_at';

export function toPublicSession(row: BankSessionRow) {
  return {
    institutionKey: row.institution_key,
    institutionLabel: row.institution_label,
    state: row.state,
    startUrl: row.start_url,
    schedule: row.schedule,
    nextFetchAt: row.next_fetch_at,
    lastLoginAt: row.last_login_at,
    lastFetchAt: row.last_fetch_at,
    lastStatus: row.last_status,
    fetchedRows: Array.isArray(row.seen_keys) ? row.seen_keys.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

const MAGIC = Buffer.from('CPBS1');
let cachedKey: Buffer | null = null;

function sessionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const explicit = process.env.FINANCES_BANK_SESSION_KEY?.trim();
  if (explicit) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicit)) throw new Error('FINANCES_BANK_SESSION_KEY must be 64 hex characters');
    cachedKey = Buffer.from(explicit, 'hex');
    return cachedKey;
  }
  const master = requireEncryptionKey('bank session storage');
  cachedKey = Buffer.from(hkdfSync('sha256', Buffer.from(master, 'hex'), Buffer.alloc(0), 'coinpay-bank-sessions-v1', 32));
  return cachedKey;
}

/** Test seam. */
export function resetSessionKey(): void {
  cachedKey = null;
}

/** Bound to the merchant and bank: a sealed blob moved to another row will not open. */
export function sealState(state: SessionState, merchantId: string, institutionKey: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey(), iv);
  cipher.setAAD(Buffer.from(`${merchantId}:${institutionKey}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function openState(sealed: Buffer, merchantId: string, institutionKey: string): SessionState {
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a sealed bank session');
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = sealed.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = createDecipheriv('aes-256-gcm', sessionKey(), iv);
  decipher.setAAD(Buffer.from(`${merchantId}:${institutionKey}`));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(sealed.subarray(MAGIC.length + 28)), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as SessionState;
}

// ---------------------------------------------------------------------------
// Capture and restore through the DevTools protocol
// ---------------------------------------------------------------------------

type Cdp = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
};

const MAX_COOKIES = 3000;
const MAX_STORAGE_BYTES = 2 * 1024 * 1024;

/** Every cookie in the browser (httpOnly included) and the page's own localStorage. */
export async function captureState(cdp: Cdp, pageSession: string | null): Promise<SessionState> {
  const { cookies } = (await cdp.send('Storage.getCookies')) as { cookies: SavedCookie[] };
  const storage: Record<string, [string, string][]> = {};
  if (pageSession) {
    try {
      const { result } = (await cdp.send(
        'Runtime.evaluate',
        { expression: 'JSON.stringify({ origin: location.origin, items: Object.entries(localStorage) })', returnByValue: true },
        pageSession,
      )) as { result: { value?: string } };
      const parsed = JSON.parse(result.value ?? '{}') as { origin?: string; items?: [string, string][] };
      if (parsed.origin?.startsWith('https://') && Array.isArray(parsed.items) && JSON.stringify(parsed.items).length < MAX_STORAGE_BYTES) {
        storage[parsed.origin] = parsed.items;
      }
    } catch {
      // A page without storage access (an error page) has nothing to keep.
    }
  }
  let userAgent: string | null = null;
  try {
    userAgent = String(((await cdp.send('Browser.getVersion')) as { userAgent?: string }).userAgent ?? '').replace('HeadlessChrome', 'Chrome') || null;
  } catch {
    userAgent = null;
  }
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    userAgent,
    cookies: (cookies ?? []).slice(0, MAX_COOKIES).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires } : {}),
      httpOnly: c.httpOnly,
      secure: c.secure,
      ...(c.sameSite ? { sameSite: c.sameSite } : {}),
      ...(c.priority ? { priority: c.priority } : {}),
      ...(c.sourceScheme ? { sourceScheme: c.sourceScheme } : {}),
      ...(typeof c.sourcePort === 'number' ? { sourcePort: c.sourcePort } : {}),
      ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
    })),
    storage,
  };
}

/** Runs in the page with (origin, items) as arguments; a fixed string, no interpolation. */
export const RESTORE_STORAGE = `function (origin, items) {
  if (location.origin !== origin || !Array.isArray(items)) return false;
  for (const pair of items) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') continue;
    try { localStorage.setItem(pair[0], pair[1]); } catch (e) {}
  }
  return true;
}`;

/**
 * Put a saved session back into a fresh browser: cookies first, then each
 * origin's localStorage, set from a page on that origin (robots.txt is the
 * cheapest same-origin document there is).
 */
export async function restoreState(cdp: Cdp, pageSession: string, state: SessionState): Promise<void> {
  if (state.cookies.length) await cdp.send('Storage.setCookies', { cookies: state.cookies });
  for (const [origin, items] of Object.entries(state.storage).slice(0, 3)) {
    if (!items.length || !origin.startsWith('https://')) continue;
    await cdp.send('Page.navigate', { url: `${origin}/robots.txt` }, pageSession).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // The saved values came from the bank's page: pass them as call arguments,
    // never spliced into the code that runs there.
    try {
      const { result } = (await cdp.send('Runtime.evaluate', { expression: 'globalThis' }, pageSession)) as { result: { objectId?: string } };
      if (!result.objectId) continue;
      await cdp.send(
        'Runtime.callFunctionOn',
        {
          objectId: result.objectId,
          functionDeclaration: RESTORE_STORAGE,
          arguments: [{ value: origin }, { value: items }],
          returnByValue: true,
        },
        pageSession,
      );
    } catch {
      // A page that will not take storage keeps the cookies, which matter most.
    }
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export async function listBankSessions(merchantId: string): Promise<BankSessionRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('finance_bank_sessions')
    .select(COLUMNS)
    .eq('merchant_id', merchantId)
    .neq('state', 'disconnected')
    .order('institution_key');
  if (error) throw new Error(`Could not list bank sessions: ${error.message}`);
  return (data ?? []) as BankSessionRow[];
}

export async function getBankSession(merchantId: string, institutionKey: string): Promise<BankSessionRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('finance_bank_sessions')
    .select(COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('institution_key', institutionKey)
    .maybeSingle();
  if (error) throw new Error(`Could not load the bank session: ${error.message}`);
  return (data as BankSessionRow | null) ?? null;
}

export async function loadSessionState(row: BankSessionRow): Promise<SessionState | null> {
  if (!row.object_key) return null;
  return openState(await getObject(row.object_key), row.merchant_id, row.institution_key);
}

/**
 * Save a session after a sign-in or a fetch: seal, store, point the row at it,
 * and remove the previous object. Creates the row on first save.
 */
export async function saveSession(params: {
  access: { id: string; actorId: string };
  institutionKey: string;
  institutionLabel: string | null;
  state: SessionState;
  startUrl?: string | null;
  status: BankSessionRow['state'];
  login?: boolean;
  lastStatus?: string | null;
  seenKeys?: string[];
  nextFetchAt?: string | null;
}): Promise<BankSessionRow> {
  const supabase = getSupabaseAdmin();
  const existing = await getBankSession(params.access.id, params.institutionKey);
  const stored = await putObject('bank-sessions', params.access.id, sealState(params.state, params.access.id, params.institutionKey));
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    merchant_id: params.access.id,
    institution_key: params.institutionKey,
    institution_label: params.institutionLabel ?? existing?.institution_label ?? null,
    object_key: stored.objectKey,
    state: params.status,
    cookie_count: params.state.cookies.length,
    updated_at: now,
  };
  if (params.startUrl !== undefined) patch.start_url = params.startUrl;
  if (params.login) {
    patch.last_login_at = now;
    patch.created_by = params.access.actorId;
  }
  if (params.lastStatus !== undefined) patch.last_status = params.lastStatus;
  if (params.seenKeys) patch.seen_keys = params.seenKeys.slice(-1000);
  if (params.nextFetchAt !== undefined) patch.next_fetch_at = params.nextFetchAt;

  const { data, error } = await supabase
    .from('finance_bank_sessions')
    .upsert(patch, { onConflict: 'merchant_id,institution_key' })
    .select(COLUMNS)
    .single();
  if (error) {
    await deleteObject(stored.objectKey).catch(() => undefined);
    throw new Error(`Could not save the bank session: ${error.message}`);
  }
  if (existing?.object_key && existing.object_key !== stored.objectKey) await deleteObject(existing.object_key).catch(() => undefined);
  if (params.login) {
    await auditFinance(params.access, 'bank_session.saved', 'bank_session', (data as BankSessionRow).id, {
      institution: params.institutionKey,
      cookies: params.state.cookies.length,
    });
  }
  return data as BankSessionRow;
}

export async function updateBankSession(merchantId: string, institutionKey: string, patch: Partial<Pick<BankSessionRow, 'state' | 'last_status' | 'last_fetch_at' | 'next_fetch_at' | 'schedule' | 'seen_keys'>>): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('finance_bank_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('merchant_id', merchantId)
    .eq('institution_key', institutionKey);
  if (error) throw new Error(`Could not update the bank session: ${error.message}`);
}

/** Forget a bank: the sealed session is deleted at once; statements already fetched stay. */
export async function disconnectBankSession(access: { id: string; actorId: string }, institutionKey: string): Promise<boolean> {
  const row = await getBankSession(access.id, institutionKey);
  if (!row) return false;
  if (row.object_key) await deleteObject(row.object_key).catch(() => undefined);
  const { error } = await getSupabaseAdmin().from('finance_bank_sessions').delete().eq('id', row.id).eq('merchant_id', access.id);
  if (error) throw new Error(`Could not disconnect: ${error.message}`);
  await auditFinance(access, 'bank_session.disconnected', 'bank_session', row.id, { institution: institutionKey });
  return true;
}
