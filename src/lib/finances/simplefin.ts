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
  /** UNIX seconds. `0` or absent on a pending item that has not posted yet. */
  posted?: number | null;
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

/**
 * An upstream bank login, as the 2.0 draft reports it. Two logins at the same
 * institution can hand out the same account id, so an account's identity is
 * `(conn_id, id)` rather than `id` alone.
 */
export interface SimpleFinConnection {
  conn_id: string;
  name?: string;
  org_id?: string;
  org_url?: string;
  sfin_url?: string;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  /** 2.0 draft: the upstream login this account came through. */
  conn_id?: string;
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
  /** 2.0 draft: the upstream logins behind `accounts[].conn_id`. */
  connections?: SimpleFinConnection[];
  errors?: string[];
  errlist?: unknown[];
  'x-api-message'?: string[];
  /**
   * The provider's response exactly as received, for the payload archive.
   * Attached by the client, never sent by the provider, and stripped before
   * the set is handed to anything that would serialise it.
   */
  rawBody?: string;
}

/** Protocol versions this client has fixtures for. */
export const SIMPLEFIN_PROTOCOL_VERSIONS = [1, 2] as const;
export type SimpleFinProtocolVersion = (typeof SIMPLEFIN_PROTOCOL_VERSIONS)[number];

/**
 * A provider failure with its scope preserved. `connId`/`accountId` say which
 * login or account the message is about, so one bank needing re-auth marks
 * that source partial rather than the whole credential.
 */
export interface ProviderError {
  code: string;
  message: string;
  connId: string | null;
  accountId: string | null;
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
  /** Which protocol shape to ask for. Omitted = the server's default. */
  version?: SimpleFinProtocolVersion;
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
 * Hosts a claim URL or access URL may point at.
 *
 * A setup token is base64 of an arbitrary URL, and the server POSTs to it with
 * no user in the loop. Without a list, a crafted token turns the claim route
 * into a request forged from inside the deployment — to a metadata endpoint,
 * a private service, or a listener that harvests the Basic credentials the
 * access URL carries. Override with `FINANCES_SIMPLEFIN_ALLOWED_HOSTS`
 * (comma-separated) for a self-hosted bridge.
 */
export const DEFAULT_ALLOWED_HOSTS = ['beta-bridge.simplefin.org', 'bridge.simplefin.org'];

export function allowedProviderHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.FINANCES_SIMPLEFIN_ALLOWED_HOSTS;
  if (!raw || !raw.trim()) return DEFAULT_ALLOWED_HOSTS;
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^metadata(\.google\.internal)?$/i,
  /^\[?[0-9a-f:]*:[0-9a-f:]*\]?$/i, // any IPv6 literal
  /^\d{1,3}(\.\d{1,3}){3}$/, // any IPv4 literal
  /^0x[0-9a-f]+$/i,
  /^\d+$/,
];

/**
 * Refuse any URL a credential-bearing request must not be sent to.
 *
 * Checks the scheme, the host against the allowlist, the port, and rejects
 * every IP literal outright — an allowlisted name resolving to a private
 * address is the provider's DNS being wrong, which the allowlist cannot fix,
 * but a literal `169.254.169.254` or `[::1]` never has a legitimate reason
 * to appear here.
 *
 * @throws {Error} when the destination is not an approved HTTPS provider host
 */
export function assertAllowedProviderUrl(
  rawUrl: string,
  { allowedHosts = allowedProviderHosts(), purpose = 'provider' }: { allowedHosts?: string[]; purpose?: string } = {},
): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`The SimpleFIN ${purpose} URL is not a valid URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`The SimpleFIN ${purpose} URL must use https`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || BLOCKED_HOST_PATTERNS.some((p) => p.test(host))) {
    throw new Error(`The SimpleFIN ${purpose} URL points at a host that is not allowed`);
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error(`The SimpleFIN ${purpose} URL must use the default https port`);
  }
  if (!allowedHosts.includes(host)) {
    throw new Error(
      `The SimpleFIN ${purpose} URL host "${host}" is not an approved provider host`,
    );
  }
}

/**
 * Sanitised reason for a claim that did not complete cleanly. Distinguishes
 * "the token is provably unspent" from "we cannot tell" so the caller can
 * give the right recovery instruction.
 */
export type ClaimOutcome = 'not_claimed' | 'unknown';

export class ClaimError extends Error {
  outcome: ClaimOutcome;
  constructor(message: string, outcome: ClaimOutcome) {
    super(message);
    this.outcome = outcome;
  }
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
  // Nothing has been sent yet: every failure up to the fetch leaves the token
  // unspent, and says so.
  assertAllowedProviderUrl(claimUrl, { purpose: 'claim' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(claimUrl, {
      method: 'POST',
      headers: { 'Content-Length': '0' },
      signal: controller.signal,
      // A redirect would carry the POST to a destination nobody validated.
      redirect: 'manual',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // The request may have landed. The bridge could have consumed the token
      // and we never saw the answer, so replaying is not safe.
      throw new ClaimError(
        'Timed out claiming the SimpleFIN setup token. The token may or may not have been used; disable it at the bridge and generate a new one.',
        'unknown',
      );
    }
    throw new ClaimError(
      `Could not reach the SimpleFIN bridge: ${err instanceof Error ? err.message : 'unknown error'}. The token may or may not have been used; if it was, disable it at the bridge and generate a new one.`,
      'unknown',
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new ClaimError(
      'SimpleFIN bridge answered the claim with a redirect, which is not followed. Disable the token at the bridge and generate a new one.',
      'unknown',
    );
  }

  if (response.status === 403) {
    throw new ClaimError(
      'This setup token has already been claimed. Setup tokens are single-use — generate a new one.',
      'not_claimed',
    );
  }

  if (response.status === 402) {
    throw new ClaimError(
      'The SimpleFIN bridge reports that its subscription needs attention before this token can be claimed.',
      'not_claimed',
    );
  }

  if (!response.ok) {
    throw new ClaimError(
      `SimpleFIN bridge rejected the claim (HTTP ${response.status})`,
      response.status >= 500 ? 'unknown' : 'not_claimed',
    );
  }

  const accessUrl = (await response.text()).trim();
  if (!/^https:\/\//i.test(accessUrl)) {
    throw new ClaimError('SimpleFIN bridge did not return an access URL', 'unknown');
  }

  // Fail here rather than at the first sync, while the operator still has the
  // context to fix it — the token is spent either way.
  const parsedAccess = parseAccessUrl(accessUrl);
  assertAllowedProviderUrl(parsedAccess.baseUrl, { purpose: 'access' });

  return accessUrl;
}

/** Stable codes a caller can act on without parsing a message. */
export type ProviderErrorCode =
  | 'provider_reconnect_required'
  | 'provider_payment_required'
  | 'provider_rate_limited'
  | 'provider_error';

export class ProviderRequestError extends Error {
  code: ProviderErrorCode;
  /** From `Retry-After`, when the provider sent one. */
  retryAfterMs: number | null;
  constructor(message: string, code: ProviderErrorCode, retryAfterMs: number | null = null) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
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
  assertAllowedProviderUrl(parsed.baseUrl, { purpose: 'access' });

  const params = new URLSearchParams();
  if (options.version) params.set('version', String(options.version));
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
      // Credentials ride on this request; they go to the validated host only.
      redirect: 'manual',
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

  if (response.status >= 300 && response.status < 400) {
    throw new ProviderRequestError('SimpleFIN answered with a redirect, which is not followed', 'provider_error');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderRequestError(
      'SimpleFIN rejected the stored credentials — the connection needs re-linking',
      'provider_reconnect_required',
    );
  }
  if (response.status === 402) {
    // The bridge subscription lapsed. This is the merchant's bill with the
    // provider, not something CoinPay pays or retries with a wallet.
    throw new ProviderRequestError(
      'The SimpleFIN bridge subscription needs attention before data can be fetched',
      'provider_payment_required',
    );
  }
  if (response.status === 429) {
    throw new ProviderRequestError(
      'SimpleFIN rate limit reached (about 24 requests per day). Try again later.',
      'provider_rate_limited',
      retryAfterMs(response.headers.get('retry-after')),
    );
  }
  if (!response.ok) {
    throw new ProviderRequestError(`SimpleFIN returned HTTP ${response.status}`, 'provider_error');
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

  Object.defineProperty(set, 'rawBody', { value: body, enumerable: false, writable: true });
  return set;
}

/**
 * Normalise the two error spellings into one list of strings, so a partially
 * failed sync can say which institution stopped answering.
 */
export function collectErrors(set: SimpleFinAccountSet): string[] {
  return collectProviderErrors(set).map((e) => e.message);
}

/**
 * Every failure the provider reported, with scope and code intact.
 *
 * The 2.0 draft spells the text `msg` and scopes it with `conn_id` /
 * `account_id`; v1 sends bare strings. An object in a shape neither version
 * describes is kept as a generic warning rather than dropped — an unknown
 * error is still an error, and silently losing it would let a failed source
 * read as a healthy one with no accounts.
 */
export function collectProviderErrors(set: SimpleFinAccountSet): ProviderError[] {
  const out: ProviderError[] = [];
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  for (const e of set.errors ?? []) {
    const message = str(e);
    if (message) out.push({ code: 'gen.', message, connId: null, accountId: null });
  }
  for (const e of set.errlist ?? []) {
    const message = str(e);
    if (message) {
      out.push({ code: 'gen.', message, connId: null, accountId: null });
      continue;
    }
    if (e && typeof e === 'object') {
      const rec = e as Record<string, unknown>;
      const text = str(rec.msg) ?? str(rec.message) ?? str(rec.error) ?? str(rec.detail);
      const code = str(rec.code) ?? 'gen.';
      const connId = str(rec.conn_id) ?? str(rec.connection_id) ?? null;
      const accountId = str(rec.account_id) ?? str(rec.account) ?? null;
      out.push({
        code,
        message: text ?? `Provider reported an error (${code}) in an unrecognised format`,
        connId,
        accountId,
      });
    } else if (e !== null && e !== undefined) {
      out.push({
        code: 'gen.',
        message: 'Provider reported an error in an unrecognised format',
        connId: null,
        accountId: null,
      });
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
