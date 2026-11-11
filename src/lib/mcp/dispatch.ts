/**
 * An in-process stand-in for the SDK's CoinPayClient, acting as one user.
 *
 * The remote MCP tools reuse the SDK's functions (listInvoices, logTime, ...),
 * which call `client.request(endpoint, options)`. Here that call never leaves
 * the process: it is routed to the very route handler the HTTP API runs, with
 * a 60-second session JWT for the OAuth `sub`, so every business, team-role and
 * row check the dashboard gets applies unchanged.
 *
 * Most of these routes do not accept OAuth tokens on purpose (the merchant API
 * requires the `merchant` scope, and several gate funds on "not OAuth"), which
 * is why the MCP cannot simply forward its bearer. Instead the reach is fixed
 * HERE: an explicit allowlist of (method, path) pairs, all reads plus three
 * draft/record writes. Anything else throws before a handler is touched, so no
 * tool argument can steer the minted credential to sends, payouts, pay runs or
 * deletes. The JWT is created per call and never returned to the client.
 */
import { NextRequest } from 'next/server';
import { generateToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { issuer } from '@/lib/oauth/metadata';

type Handler = (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

type Route = {
  method: 'GET' | 'POST';
  /** Path under /api, `:id` matching one UUID. */
  pattern: RegExp;
  load: () => Promise<Handler>;
};

const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
const p = (path: string) => new RegExp(`^${path.replace(':id', UUID)}$`);

/** Every API call a remote MCP tool may make. Order matters: /invoices/aging before /invoices/:id. */
export const MCP_ROUTES: Route[] = [
  { method: 'GET', pattern: p('/invoices'), load: async () => (await import('@/app/api/invoices/route')).GET as Handler },
  { method: 'POST', pattern: p('/invoices'), load: async () => (await import('@/app/api/invoices/route')).POST as Handler },
  { method: 'GET', pattern: p('/invoices/aging'), load: async () => (await import('@/app/api/invoices/aging/route')).GET as Handler },
  { method: 'GET', pattern: p('/invoices/:id'), load: async () => (await import('@/app/api/invoices/[id]/route')).GET as Handler },
  { method: 'GET', pattern: p('/projects'), load: async () => (await import('@/app/api/projects/route')).GET as Handler },
  { method: 'GET', pattern: p('/projects/:id'), load: async () => (await import('@/app/api/projects/[id]/route')).GET as Handler },
  { method: 'POST', pattern: p('/projects/:id/invoice'), load: async () => (await import('@/app/api/projects/[id]/invoice/route')).POST as Handler },
  { method: 'POST', pattern: p('/time-entries'), load: async () => (await import('@/app/api/time-entries/route')).POST as Handler },
  { method: 'GET', pattern: p('/contractors'), load: async () => (await import('@/app/api/contractors/route')).GET as Handler },
  { method: 'GET', pattern: p('/contractors/:id'), load: async () => (await import('@/app/api/contractors/[id]/route')).GET as Handler },
  { method: 'GET', pattern: p('/contractor-work-items'), load: async () => (await import('@/app/api/contractor-work-items/route')).GET as Handler },
  { method: 'GET', pattern: p('/pay-runs'), load: async () => (await import('@/app/api/pay-runs/route')).GET as Handler },
  { method: 'GET', pattern: p('/pay-runs/:id'), load: async () => (await import('@/app/api/pay-runs/[id]/route')).GET as Handler },
  { method: 'GET', pattern: p('/documents'), load: async () => (await import('@/app/api/documents/route')).GET as Handler },
  { method: 'GET', pattern: p('/documents/:id'), load: async () => (await import('@/app/api/documents/[id]/route')).GET as Handler },
];

export class McpApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Find the allowlisted route for a request, or null. */
export function matchRoute(method: string, endpoint: string): { route: Route; id: string | null; path: string; search: string } | null {
  let url: URL;
  try {
    url = new URL(endpoint, 'http://in-process');
  } catch {
    return null;
  }
  // Only a plain relative API path: no scheme, host, dot segments or encoded slashes.
  if (!endpoint.startsWith('/') || endpoint.startsWith('//') || url.host !== 'in-process') return null;
  const rawPath = endpoint.split(/[?#]/)[0];
  if (/%2f|%5c|%2e|\/\.\.?(\/|$)/i.test(rawPath) || rawPath.includes('\\') || rawPath !== url.pathname) return null;
  for (const route of MCP_ROUTES) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(url.pathname);
    if (m) return { route, id: m[1] ?? null, path: url.pathname, search: url.search };
  }
  return null;
}

export type InProcessClient = {
  request: (endpoint: string, options?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<any>;
};

/** A CoinPayClient look-alike for `userId`, limited to MCP_ROUTES. */
export function inProcessClient(userId: string): InProcessClient {
  return {
    async request(endpoint, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      const match = matchRoute(method, endpoint);
      if (!match) throw new McpApiError(`Not available to the CoinPay connector: ${method} ${endpoint.split('?')[0]}`, 403);

      const session = generateToken({ userId, via: 'mcp' }, getJwtSecret(), 60);
      const url = new URL(`/api${match.path}${match.search}`, issuer());
      const request = new NextRequest(url, {
        method,
        headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json', 'user-agent': 'coinpay-remote-mcp' },
        ...(method === 'GET' ? {} : { body: options.body ?? '{}' }),
      });

      const handler = await match.route.load();
      const response = await handler(request, { params: Promise.resolve({ id: match.id ?? '' }) });
      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        throw new McpApiError((data && (data.error || data.message)) || `HTTP ${response.status}`, response.status, data?.code);
      }
      return data;
    },
  };
}
