/**
 * JSON-RPC for the remote MCP server (stateless streamable HTTP, JSON replies).
 *
 * initialize, ping, tools/list and tools/call; notifications are accepted and
 * answered with nothing (the route turns that into 202). tools/list carries
 * resultType/ttlMs/cacheScope, which Claude's client requires on every list.
 */
import { createClient } from '@supabase/supabase-js';
import { MCP_TOOLS, checkArgs, type McpTool } from './tools';
import { inProcessClient, McpApiError, type InProcessClient } from './dispatch';
import { listAccessibleBusinessIds } from '@/lib/auth/authz';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

export const SERVER_INFO = { name: 'coinpay', title: 'CoinPay', version: '1.0.0' };

/** Protocol revisions this server answers as. The client's own is echoed when listed. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST_PROTOCOL_VERSION = '2025-06-18';

export const INSTRUCTIONS =
  'CoinPay invoicing for the signed-in CoinPay user: invoices (list, get, accounts-receivable aging, create DRAFT), ' +
  'projects and time (list, get, log time, bill unbilled time as a DRAFT invoice), contractors, contractor work, ' +
  'pay runs and e-sign document status. Nothing here sends an invoice or email, approves work, pays anyone or moves ' +
  'funds; the user does that in the CoinPay dashboard. Tools that take businessId fill it in when the user has one ' +
  'business; with several, the error lists them so you can ask which one.';

/** List results must say how long they may be cached and by whom (private: per user). */
const LIST_CACHE = { resultType: 'complete' as const, ttlMs: 300_000, cacheScope: 'private' as const };

export type JsonRpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
export type JsonRpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export type ServerContext = {
  userId: string;
  /** Override for tests. */
  client?: InProcessClient;
  businesses?: (userId: string) => Promise<Array<{ id: string; name: string | null }>>;
  rateLimit?: (userId: string) => Promise<boolean>;
};

function supabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function accessibleBusinesses(userId: string): Promise<Array<{ id: string; name: string | null }>> {
  const sb = supabase();
  const ids = await listAccessibleBusinessIds(sb, userId);
  if (ids.length === 0) return [];
  const { data } = await sb.from('businesses').select('id, name').in('id', ids).order('created_at');
  return (data ?? []).map((b: { id: string; name: string | null }) => ({ id: b.id, name: b.name }));
}

async function allowCall(userId: string): Promise<boolean> {
  return (await checkRateLimitAsync(userId, 'mcp_tool_call')).allowed;
}

export function listTools() {
  return MCP_TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  isError,
});

async function callTool(tool: McpTool, args: Record<string, any>, ctx: ServerContext) {
  const businesses = ctx.businesses ?? accessibleBusinesses;
  const client = ctx.client ?? inProcessClient(ctx.userId);
  const businessId = async (given: unknown): Promise<string> => {
    if (typeof given === 'string' && given) return given;
    const list = await businesses(ctx.userId);
    if (list.length === 1) return list[0].id;
    if (list.length === 0) throw new McpApiError('You have no CoinPay business yet; create one in the CoinPay dashboard first.', 400);
    throw new McpApiError(
      `You have ${list.length} businesses; pass businessId. ` +
        list.map((b) => `${b.name ?? '(unnamed)'}: ${b.id}`).join('; '),
      400
    );
  };
  const callArgs = { ...args };
  if (tool.needsBusiness) callArgs.businessId = await businessId(args.businessId);
  return tool.handler(callArgs, { client, businessId });
}

/** Answer one JSON-RPC message; null for a notification (or a response from the client). */
export async function handleMessage(message: JsonRpcMessage, ctx: ServerContext): Promise<JsonRpcResponse | null> {
  const isRequest = message && typeof message === 'object' && 'id' in message && message.id !== undefined;
  const id = isRequest ? (message.id as string | number | null) : null;
  const reply = (result: unknown): JsonRpcResponse | null => (isRequest ? { jsonrpc: '2.0', id, result } : null);
  const fail = (code: number, msg: string): JsonRpcResponse | null => (isRequest ? { jsonrpc: '2.0', id, error: { code, message: msg } } : null);

  if (!message || typeof message !== 'object' || typeof message.method !== 'string') {
    // A JSON-RPC response sent to us (we never ask the client anything) or junk.
    return message && typeof message === 'object' && !('method' in message) ? null : fail(-32600, 'Invalid Request');
  }
  const params = message.params && typeof message.params === 'object' ? message.params : {};

  switch (message.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return reply({
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: listTools(), ...LIST_CACHE });
    case 'tools/call': {
      const tool = MCP_TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(params.name)}`);
      const args = params.arguments ?? {};
      const bad = checkArgs(tool.inputSchema, args);
      if (bad) return reply(text(`Invalid arguments: ${bad}`, true));
      if (!(await (ctx.rateLimit ?? allowCall)(ctx.userId))) {
        return reply(text('Rate limit: at most 60 CoinPay tool calls a minute. Wait a moment and try again.', true));
      }
      try {
        return reply(text(await callTool(tool, args, ctx)));
      } catch (err) {
        if (err instanceof McpApiError) return reply(text(`${err.message}${err.code ? ` (${err.code})` : ''}`, true));
        console.error(`[mcp] ${tool.name} failed:`, err);
        return reply(text(`${tool.name} failed on CoinPay's side; try again shortly.`, true));
      }
    }
    default:
      if (message.method.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${message.method}`);
  }
}
