/** Types for `@profullstack/coinpay/statements` (src/statements-fetch.js). */

export class StatementFetchError extends Error {}

export interface FetcherAccount {
  id: string;
  name: string;
  last4: string | null;
  institution: string;
}

export interface Institution {
  key: string;
  name: string;
  url: string | null;
  accounts: FetcherAccount[];
}

export interface Period {
  month: string;
  from: string | null;
  to: string | null;
}

export interface ImportSpan {
  period?: string;
  from?: string;
  to?: string;
  cycle?: 'custom';
}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export interface Cdp {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  on(listener: (event: CdpEvent) => void): () => void;
  waitFor(method: string, sessionId: string, timeoutMs: number): Promise<boolean>;
}

export interface Browser {
  cdp: Cdp;
  exited: Promise<void>;
  close(): Promise<void>;
}

export interface Download {
  bytes: Buffer;
  suggestedName: string;
  label: string;
  context: string;
  key: string | null;
}

export type PageStatus = 'ok' | 'login_needed' | 'no_statements';

export function lastFour(name: string): string | null;
export function slug(value: string): string;
export function institutionKey(domain: string | null | undefined, name: string | null | undefined): string;
export function groupInstitutions(accounts: ReadonlyArray<{ id: string; name: string; org_name?: string | null; org_domain?: string | null; is_hidden?: boolean }>): Institution[];
export function pickInstitution(institutions: readonly Institution[], name: string): Institution;
export const DRIVERS: ReadonlyArray<{ key: string; login: string; statements?: string }>;
export function startUrls(institution: { key: string; url: string | null }, learnt?: string | null): { login: string | null; fetch: string | null };
export function isSignInUrl(url: string): boolean;
export function findDates(source: string | null | undefined): { date: string; precise: boolean }[];
export function periodOf(...sources: ReadonlyArray<string | null | undefined>): Period | null;
export function matchAccount(accounts: readonly FetcherAccount[], ...sources: ReadonlyArray<string | null | undefined>): FetcherAccount | null;
export function importPeriod(period: Period | null): ImportSpan | null;
export function candidateKey(candidate: { label: string; context: string; href: string | null }): string;
export function isPdf(bytes: Uint8Array): boolean;
export function sha256(bytes: Uint8Array): string;
export function statementsHome(env?: Record<string, string | undefined>): string;
export function profileDir(key: string, home?: string): string;
export function signedIn(key: string, home?: string): boolean;
export function findChrome(env?: Record<string, string | undefined>, home?: string): string | null;
export const NO_CHROME: string;
export function profileLock(profile: string): { host: string; pid: number } | null;
export function releaseProfile(profile: string, options?: { force?: boolean }): Promise<'free' | 'stale' | 'stopped'>;
export function preferPdfDownloads(profile: string): void;
export function openBrowser(options: {
  chrome: string;
  profile: string;
  headless?: boolean;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  force?: boolean;
  extraArgs?: string[];
  handleSignals?: boolean;
}): Promise<Browser>;
export const SIGNED_OUT: string;
export const OPEN_STATEMENTS: string;
export const COLLECT: string;
export const SECOND_STEP: string;
export const CLICK_RECORDER: string;
export function clickScript(index: number): string;
export function fetchInstitution(
  browser: Browser,
  options: {
    start: string;
    seen?: Set<string>;
    since?: string | null;
    max?: number;
    renderMs?: number;
    onFile: (download: Download) => Promise<void> | void;
    log?: (line: string) => void;
  },
): Promise<{ status: PageStatus; url: string; candidates: number; silent: string[] }>;
export function loginWindow(browser: Browser, url: string): Promise<string | null>;
export function assistWindow(browser: Browser, options: { start: string; onFile: (download: Download) => Promise<void> | void }): Promise<number>;
export function loadLocal(home?: string): { institutions: Record<string, Record<string, unknown>>; entries: Record<string, unknown>[] };
export function saveLocal(state: unknown, home?: string): void;
export function archive(home: string, institution: Institution, account: FetcherAccount | null, period: Period | null, suggestedName: string, bytes: Uint8Array): string;
export function keepStatement(options: Record<string, unknown>): Promise<Record<string, unknown>>;
export function runStatementFetch(options: Record<string, unknown>): Promise<Record<string, unknown>[]>;
export function clientApi(client: unknown): Promise<{
  listAccounts(): Promise<unknown[]>;
  importStatement(options: Record<string, unknown>): Promise<unknown>;
  reportRun(run: Record<string, unknown>): Promise<unknown>;
}>;
export function retryImports(options: Record<string, unknown>): Promise<{ imported: number; skipped: number; failed: number }>;
