/**
 * SimpleFIN protocol client — https://www.simplefin.org/protocol.html
 *
 * SimpleFIN is a read-only aggregation protocol: it hands out balances and
 * transactions and can never move money. The whole surface is two calls.
 *
 *   1. `claimSetupToken(token)` — a setup token is a base64-encoded *claim URL*.
 *      POSTing to it returns an access URL. This is one-shot: the second POST
 *      gets a 403, and there is no way to recover the access URL afterwards, so
 *      callers must persist the return value before doing anything else.
 *
 *   2. `fetchAccountSet(accessUrl, opts)` — GET /accounts. The access URL
 *      carries HTTP Basic credentials inline; they are split out and sent as an
 *      Authorization header rather than left in the request URL, so they never
 *      reach a log line, a redirect target or an error message.
 *
 * The server is rate limited to roughly 24 requests per day across all
 * accounts, which is the reason sync is an explicit action rather than
 * something that runs on page load.
 */

/** A financial institution, as SimpleFIN repeats it on every account. */
export interface SimpleFinOrg {
  id?: string;
  name?: string;
  domain?: string;
  url?: string;
  'sfin-url'?: string;
}

/** One transaction. Amounts are decimal strings, timestamps UNIX seconds. */
export interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description?: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  mcc?: string | number | null;
  pending?: boolean;
  extra?: Record<string, unknown>;
  /**
   * Id of a pending transaction that this one replaces.
   *
   * Not part of the SimpleFIN protocol — SimpleFIN keeps the same id when a
   * transaction posts, so it never sets this. Plaid issues a NEW id on posting
   * and points back at the pending one, so without this the pending row is
   * never removed and a single charge is stored, and summed, twice.
   *
   * This shape is the internal one (see ./provider.ts), which is why a
   * provider-neutral field lives on it.
   */
  supersedes?: string;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date'?: number;
  org?: SimpleFinOrg;
  transactions?: SimpleFinTransaction[];
  extra?: Record<string, unknown>;
}

/**
 * The /accounts response. `errors` is the v1 spelling and `errlist` the v2
 * one; both are accepted because the bridge answers with whichever matches the
 * requested version, and a caller that only reads one will silently treat a
 * failed institution as an institution with no accounts.
 */
export interface SimpleFinAccountSet {
  accounts: SimpleFinAccount[];
  errors?: string[];
  errlist?: unknown[];
  'x-api-message'?: string[];
}

export interface FetchAccountsOptions {
  /** Only transactions posted on or after this instant. */
  startDate?: Date;
  /** Only transactions posted before this instant. */
  endDate?: Date;
  /** Include not-yet-posted transactions. */
  pending?: boolean;
  /** Skip transactions entirely — much cheaper when only balances are wanted. */
  balancesOnly?: boolean;
  /** Restrict to specific SimpleFIN account ids. */
  accountIds?: string[];
  /** Abort the request after this many milliseconds. */
  timeoutMs?: number;
}

/** Credentials and endpoint pulled apart from an access URL. */
interface ParsedAccessUrl {
  baseUrl: string;
  username: string;
  password: string;
}

/**
 * Split `https://user:pass@host/path` into an endpoint plus credentials.
 *
 * Done by hand rather than through `new URL()` because SimpleFIN passwords are
 * opaque and routinely contain characters that `URL` percent-decodes on the way
 * out, which would corrupt the credential. Only the last `@` before the path is
 * treated as the separator, so a password containing `@` survives.
 *
 * @throws {Error} when the URL carries no credentials — an access URL always does.
 */
export function parseAccessUrl(accessUrl: string): ParsedAccessUrl {
  const trimmed = accessUrl.trim();
  const schemeSplit = trimmed.indexOf('://');
  if (schemeSplit === -1) {
    throw new Error('SimpleFIN access URL is missing a scheme');
  }

  const scheme = trimmed.slice(0, schemeSplit);
  const rest = trimmed.slice(schemeSplit + 3);

  // The authority ends at the first '/', '?' or '#'. Anything after that is
  // path and cannot contain the credential separator.
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const path = authorityEnd === -1 ? '' : rest.slice(authorityEnd);

  const at = authority.lastIndexOf('@');
  if (at === -1) {
    throw new Error('SimpleFIN access URL is missing credentials');
  }

  const credentials = authority.slice(0, at);
  const host = authority.slice(at + 1);

  const colon = credentials.indexOf(':');
  const username = colon === -1 ? credentials : credentials.slice(0, colon);
  const password = colon === -1 ? '' : credentials.slice(colon + 1);

  if (!host) {
    throw new Error('SimpleFIN access URL is missing a host');
  }

  return {
    baseUrl: `${scheme}://${host}${path}`.replace(/\/+$/, ''),
    username,
    password,
  };
}

/** `Basic base64(user:pass)` for an access URL. */
function basicAuthHeader({ username, password }: ParsedAccessUrl): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/**
 * Redact the credential out of anything that might carry one, so an access URL
 * cannot reach a log, an error response or the browser.
 */
export function redactAccessUrl(value: string): string {
  return value.replace(/\/\/[^/@\s]*@/g, '//***:***@');
}

/**
 * Decode a setup token to its claim URL without claiming it.
 *
 * @throws {Error} when the token is not base64 of an https URL.
 */
export function decodeSetupToken(setupToken: string): string {
  const cleaned = setupToken.trim().replace(/\s+/g, '');
  if (!cleaned) throw new Error('Setup token is empty');

  let decoded: string;
  try {
    decoded = Buffer.from(cleaned, 'base64').toString('utf8').trim();
  } catch {
    throw new Error('Setup token is not valid base64');
  }

  if (!/^https:\/\/\S+$/i.test(decoded)) {
    throw new Error('Setup token did not decode to an https URL');
  }

  return decoded;
}

/**
 * Exchange a setup token for an access URL. **Single use** — the caller owns
 * persisting the result, because a repeat claim returns 403 and the credential
 * is then unrecoverable.
 *
 * @param setupToken base64 setup token as pasted by the user
 * @returns the access URL, credentials included
 * @throws {Error} when the token is malformed, already claimed, or the bridge fails
 */
export async function claimSetupToken(
  setupToken: string,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<string> {
  const claimUrl = decodeSetupToken(setupToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(claimUrl, {
      method: 'POST',
      headers: { 'Content-Length': '0' },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Timed out claiming the SimpleFIN setup token');
    }
    throw new Error(
      `Could not reach the SimpleFIN bridge: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 403) {
    throw new Error(
      'This setup token has already been claimed. Setup tokens are single-use — generate a new one.',
    );
  }

  if (!response.ok) {
    throw new Error(`SimpleFIN bridge rejected the claim (HTTP ${response.status})`);
  }

  const accessUrl = (await response.text()).trim();
  if (!/^https:\/\//i.test(accessUrl)) {
    throw new Error('SimpleFIN bridge did not return an access URL');
  }

  // Fail here rather than at the first sync, while the operator still has the
  // context to fix it — the token is spent either way.
  parseAccessUrl(accessUrl);

  return accessUrl;
}

/** UNIX seconds, which is what SimpleFIN's date parameters take. */
function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * GET /accounts.
 *
 * @throws {Error} on auth failure, rate limiting, or an unparseable response
 */
export async function fetchAccountSet(
  accessUrl: string,
  options: FetchAccountsOptions = {},
): Promise<SimpleFinAccountSet> {
  const parsed = parseAccessUrl(accessUrl);

  const params = new URLSearchParams();
  if (options.startDate) params.set('start-date', String(toUnixSeconds(options.startDate)));
  if (options.endDate) params.set('end-date', String(toUnixSeconds(options.endDate)));
  if (options.pending) params.set('pending', '1');
  if (options.balancesOnly) params.set('balances-only', '1');
  for (const id of options.accountIds ?? []) params.append('account', id);

  const query = params.toString();
  const url = `${parsed.baseUrl}/accounts${query ? `?${query}` : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: basicAuthHeader(parsed), Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Timed out reading accounts from SimpleFIN');
    }
    throw new Error(
      `Could not reach SimpleFIN: ${redactAccessUrl(err instanceof Error ? err.message : 'unknown error')}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('SimpleFIN rejected the stored credentials — the connection needs re-linking');
  }
  if (response.status === 429) {
    throw new Error('SimpleFIN rate limit reached (about 24 requests per day). Try again later.');
  }
  if (!response.ok) {
    throw new Error(`SimpleFIN returned HTTP ${response.status}`);
  }

  const body = await response.text();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    throw new Error('SimpleFIN returned a response that was not JSON');
  }

  const set = parsedBody as SimpleFinAccountSet;
  if (!set || !Array.isArray(set.accounts)) {
    throw new Error('SimpleFIN response did not contain an accounts array');
  }

  return set;
}

/**
 * Normalise the two error spellings into one list of strings, so a partially
 * failed sync can say which institution stopped answering.
 */
export function collectErrors(set: SimpleFinAccountSet): string[] {
  const out: string[] = [];
  for (const e of set.errors ?? []) {
    if (typeof e === 'string' && e.trim()) out.push(e.trim());
  }
  for (const e of set.errlist ?? []) {
    if (typeof e === 'string' && e.trim()) out.push(e.trim());
    else if (e && typeof e === 'object') {
      const rec = e as Record<string, unknown>;
      const message = rec.message ?? rec.error ?? rec.detail;
      if (typeof message === 'string' && message.trim()) out.push(message.trim());
    }
  }
  return out;
}

/**
 * Parse a SimpleFIN decimal string.
 *
 * Returns `null` rather than `NaN` for anything unparseable so a bad value
 * lands in the database as NULL instead of poisoning every sum downstream.
 */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** UNIX seconds to an ISO instant, tolerating null/0/garbage. */
export function unixToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}
