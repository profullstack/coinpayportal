import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { decrypt } from '../crypto/encryption';
import { requireEncryptionKey } from '../crypto/require-key';
import { openMerchantSecret, sealForMerchant } from '../vault/merchant-secret';
import { isVaultError } from '../vault/vault-service';
import { audit } from '../finances/audit';

/**
 * Connect CrawlProof: a merchant pastes a read-only CrawlProof API token and
 * the business report gains a website section built from their own sites.
 *
 * - The token must be CrawlProof's `stats:read` scope. CrawlProof refuses it
 *   on every route except the tracker reads, and echoes the scope on
 *   /api/tracker/v1/report, so a full-access token (one that can post or
 *   spend ad budget) is refused here before it is ever stored.
 * - Sealed to the merchant's secrets vault (2026-10-28), one row per merchant;
 *   the report section reads it only while they are unlocked. Only the
 *   prefix is ever shown back. Disconnecting deletes the row.
 * - CrawlProof scopes every answer to the token's owner, so a merchant can
 *   only ever see the sites of whoever minted the token they pasted.
 * - Reading never throws into the report: any failure is recorded on the row
 *   and the website section is left out.
 */

export const CRAWLPROOF_SCOPE = 'stats:read';
const TOKEN_RE = /^crp_[A-Za-z0-9_-]{43}$/;
// An account with many sites takes a while: the report reads each one (up to 25).
const TIMEOUT_MS = 30_000;

export type CrawlProofRange = '1w' | '1m';

export interface CrawlProofListItem { label: string; value: number }

export interface CrawlProofSite {
  id: string;
  name: string;
  url: string;
  visitors: number | null;
  pageviews: number | null;
  hits: { humans: number; bots: number; ai: number };
  top_pages: CrawlProofListItem[];
  top_sources: CrawlProofListItem[];
  trend: { first_half: number; second_half: number; change_pct: number | null };
}

export interface CrawlProofReport {
  range: CrawlProofRange;
  generated_at: string;
  sites: CrawlProofSite[];
  truncated: number;
  totals: { visitors: number; pageviews: number; humans: number; bots: number; ai: number };
  token_scope: string | null;
}

export class CrawlProofError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function crawlProofBaseUrl(): string {
  return (process.env.CRAWLPROOF_API_URL || 'https://crawlproof.com').replace(/\/$/, '');
}

export function isCrawlProofToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): CrawlProofListItem[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is { label: unknown; value: unknown } => Boolean(x) && typeof x === 'object')
    .slice(0, 5)
    .map((x) => ({ label: String(x.label ?? '').slice(0, 200), value: num(x.value) }));

/** Validate and trim CrawlProof's answer to the fields the report uses. Pure. */
export function parseCrawlProofReport(body: unknown): CrawlProofReport {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { sites?: unknown }).sites)) {
    throw new CrawlProofError('crawlproof_bad_response', 'CrawlProof returned an unexpected answer', 502);
  }
  const b = body as Record<string, unknown>;
  const t = (b.totals ?? {}) as Record<string, unknown>;
  return {
    range: b.range === '1m' ? '1m' : '1w',
    generated_at: String(b.generated_at ?? ''),
    sites: (b.sites as Array<Record<string, unknown>>).slice(0, 25).map((s) => {
      const hits = (s.hits ?? {}) as Record<string, unknown>;
      const trend = (s.trend ?? {}) as Record<string, unknown>;
      return {
        id: String(s.id ?? ''),
        name: String(s.name ?? '').slice(0, 200),
        url: String(s.url ?? '').slice(0, 500),
        visitors: numOrNull(s.visitors),
        pageviews: numOrNull(s.pageviews),
        hits: { humans: num(hits.humans), bots: num(hits.bots), ai: num(hits.ai) },
        top_pages: list(s.top_pages),
        top_sources: list(s.top_sources),
        trend: { first_half: num(trend.first_half), second_half: num(trend.second_half), change_pct: numOrNull(trend.change_pct) },
      };
    }),
    truncated: num(b.truncated),
    totals: { visitors: num(t.visitors), pageviews: num(t.pageviews), humans: num(t.humans), bots: num(t.bots), ai: num(t.ai) },
    token_scope: typeof b.token_scope === 'string' ? b.token_scope : null,
  };
}

/** GET /api/tracker/v1/report with one token. Throws CrawlProofError. */
export async function fetchCrawlProofReport(token: string, range: CrawlProofRange = '1w', fetchImpl: typeof fetch = fetch): Promise<CrawlProofReport> {
  let res: Response;
  try {
    res = await fetchImpl(`${crawlProofBaseUrl()}/api/tracker/v1/report?range=${range}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new CrawlProofError('crawlproof_unreachable', `CrawlProof did not answer: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CrawlProofError('crawlproof_token_rejected', 'CrawlProof rejected the token (revoked, or not allowed to read stats)', 400);
  }
  if (!res.ok) throw new CrawlProofError('crawlproof_error', `CrawlProof answered ${res.status}`, 502);
  return parseCrawlProofReport(await res.json().catch(() => null));
}

export interface CrawlProofStatus {
  connected: boolean;
  tokenPrefix: string | null;
  sitesCount: number;
  connectedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  tokensUrl: string;
}

const TOKENS_URL = () => `${crawlProofBaseUrl()}/dashboard/api-tokens`;

export async function getCrawlProofStatus(merchantId: string): Promise<CrawlProofStatus> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('merchant_crawlproof_connections')
    .select('token_prefix, sites_count, connected_at, last_ok_at, last_error')
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the CrawlProof connection: ${error.message}`);
  return {
    connected: Boolean(data),
    tokenPrefix: (data?.token_prefix as string | undefined) ?? null,
    sitesCount: (data?.sites_count as number | undefined) ?? 0,
    connectedAt: (data?.connected_at as string | undefined) ?? null,
    lastOkAt: (data?.last_ok_at as string | undefined) ?? null,
    lastError: (data?.last_error as string | undefined) ?? null,
    tokensUrl: TOKENS_URL(),
  };
}

/**
 * Verify a pasted token against CrawlProof and store it. Refuses anything
 * that is not a working read-only token.
 */
export async function connectCrawlProof(merchantId: string, token: unknown, fetchImpl: typeof fetch = fetch): Promise<CrawlProofStatus> {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!isCrawlProofToken(raw)) throw new CrawlProofError('invalid_request', 'Paste a CrawlProof API token (it starts with crp_)', 400);
  const report = await fetchCrawlProofReport(raw, '1w', fetchImpl);
  if (report.token_scope !== CRAWLPROOF_SCOPE) {
    throw new CrawlProofError(
      'crawlproof_token_not_read_only',
      'That token has full access to your CrawlProof account. Generate one with "Read-only" ticked, and revoke this one if you only made it for CoinPay.',
      400,
    );
  }
  const sealed = await sealForMerchant(merchantId, raw, tokenAad(merchantId));
  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('merchant_crawlproof_connections').upsert(
    {
      merchant_id: merchantId,
      token_encrypted: sealed,
      seal_version: 2,
      token_prefix: raw.slice(0, 8),
      sites_count: report.sites.length + report.truncated,
      connected_at: now,
      last_ok_at: now,
      last_error: null,
      updated_at: now,
    },
    { onConflict: 'merchant_id' },
  );
  if (error) throw new Error(`Could not save the CrawlProof connection: ${error.message}`);
  await audit(merchantId, 'crawlproof.connect', 'merchant', merchantId, { sites: report.sites.length });
  return getCrawlProofStatus(merchantId);
}

export async function disconnectCrawlProof(merchantId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('merchant_crawlproof_connections').delete().eq('merchant_id', merchantId).select('merchant_id');
  if (error) throw new Error(`Could not disconnect CrawlProof: ${error.message}`);
  const removed = (data ?? []).length > 0;
  if (removed) await audit(merchantId, 'crawlproof.disconnect', 'merchant', merchantId, {});
  return removed;
}

/**
 * The merchant's CrawlProof numbers for the report, or null when CrawlProof
 * is not connected or could not be read. Never throws.
 */
export async function loadCrawlProofForMerchant(merchantId: string, range: CrawlProofRange = '1w', fetchImpl: typeof fetch = fetch): Promise<CrawlProofReport | null> {
  const supabase = getSupabaseAdmin();
  try {
    const { data, error } = await supabase
      .from('merchant_crawlproof_connections')
      .select('token_encrypted')
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (error || !data) return null;
    const token = await openMerchantSecret({
      merchantId,
      stored: data.token_encrypted as string,
      aad: tokenAad(merchantId),
      legacyDecrypt: (v) => decrypt(v, requireEncryptionKey('crawlproof token access')),
      persist: (next) =>
        Promise.resolve(
          supabase.from('merchant_crawlproof_connections').update({ token_encrypted: next, seal_version: 2 }).eq('merchant_id', merchantId),
        ),
    });
    const report = await fetchCrawlProofReport(token, range, fetchImpl);
    await supabase
      .from('merchant_crawlproof_connections')
      .update({ last_ok_at: new Date().toISOString(), last_error: null, sites_count: report.sites.length + report.truncated, updated_at: new Date().toISOString() })
      .eq('merchant_id', merchantId);
    return report;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    if (isVaultError(err)) {
      // Locked: a status, not a warning on every report.
      await Promise.resolve(
        supabase.from('merchant_crawlproof_connections').update({ last_error: `locked: ${message}`, updated_at: new Date().toISOString() }).eq('merchant_id', merchantId),
      ).catch(() => undefined);
      return null;
    }
    console.warn('[crawlproof] report section skipped', message);
    await Promise.resolve(
      supabase.from('merchant_crawlproof_connections').update({ last_error: message, updated_at: new Date().toISOString() }).eq('merchant_id', merchantId),
    ).catch(() => undefined);
    return null;
  }
}

export function tokenAad(merchantId: string): string {
  return `merchant_crawlproof_connections:${merchantId}:token`;
}
