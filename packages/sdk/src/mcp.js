/**
 * `coinpay mcp`: CoinPay as an MCP server over stdio.
 *
 * Newline-delimited JSON-RPC 2.0, no SDK dependency: initialize, ping,
 * tools/list and tools/call are the whole surface. stdout carries protocol
 * messages only; anything human goes to stderr.
 *
 * It runs on the merchant's machine with their `coinpay login` session, which
 * is what lets `statements_fetch` work at all: the bank sessions behind it
 * live in local Chrome profiles that CoinPay's servers never see.
 */

import { createInterface } from 'node:readline';

import * as reports from './finances-reports.js';
import { listFinanceAccounts } from './finances.js';
import * as sf from './statements-fetch.js';

export const PROTOCOL_VERSION = '2025-06-18';

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

/** Every tool: name, description, JSON schema, and a handler taking (args, ctx). */
export const TOOLS = [
  {
    name: 'finance_accounts',
    description: 'List the linked bank and card accounts (institution, name, kind, balance, id).',
    inputSchema: { type: 'object', properties: { includeHidden: { type: 'boolean' } }, additionalProperties: false },
    handler: async (args, { client }) => text({ accounts: await listFinanceAccounts(client, { includeHidden: args.includeHidden === true }) }),
  },
  {
    name: 'statements_list',
    description: 'List PDF statements in the CoinPay statement library, optionally for one account or period (2026-08, 2026-Q3).',
    inputSchema: {
      type: 'object',
      properties: { accountId: { type: 'string' }, period: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } },
      additionalProperties: false,
    },
    handler: async (args, { client }) => text({ statements: await reports.listFinanceStatements(client, { accountId: args.accountId, period: args.period, limit: args.limit }) }),
  },
  {
    name: 'statements_coverage',
    description: 'For each account, which of the last N months have a statement (have), which do not (missing), and the current month (open); plus the latest statement fetch per bank.',
    inputSchema: { type: 'object', properties: { months: { type: 'integer', minimum: 1, maximum: 36 } }, additionalProperties: false },
    handler: async (args, { client }) => text(await reports.getStatementCoverage(client, { months: args.months })),
  },
  {
    name: 'statements_fetch_runs',
    description: 'Recent statement fetch runs: per bank, ok / login_needed / no_statements / error, with counts.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 1000 } }, additionalProperties: false },
    handler: async (args, { client }) => text(await reports.listStatementFetchRuns(client, { limit: args.limit })),
  },
  {
    name: 'statements_banks',
    description: 'The linked banks and whether each is signed in on this machine for statement downloads. A bank that is not must be signed in by a person: `coinpay finances statements login <bank>`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { client, home }) => {
      const institutions = sf.groupInstitutions(await listFinanceAccounts(client));
      const state = sf.loadLocal(home);
      return text({
        chrome: sf.findChrome(),
        banks: institutions.map((i) => ({ key: i.key, name: i.name, accounts: i.accounts.map((a) => a.name), signedIn: sf.signedIn(i.key, home), ...state.institutions[i.key] })),
      });
    },
  },
  {
    name: 'statements_fetch',
    description:
      'Download every new PDF statement from the signed-in banks (or the ones named) in a headless browser on this machine and import each into the CoinPay statement library. Takes minutes. Banks needing a sign-in are reported, never signed in to.',
    inputSchema: {
      type: 'object',
      properties: {
        banks: { type: 'array', items: { type: 'string' }, description: 'Bank keys such as "chase"; all signed-in banks when omitted' },
        since: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'Skip statements that closed before this month (YYYY-MM)' },
        max: { type: 'integer', minimum: 1, maximum: 500, description: 'At most this many new statements per bank (default 24)' },
      },
      additionalProperties: false,
    },
    handler: async (args, { client, home, log }) => {
      const results = await sf.runStatementFetch({
        api: await sf.clientApi(client),
        banks: Array.isArray(args.banks) ? args.banks : [],
        since: args.since || null,
        max: args.max || 24,
        home,
        log,
        client: 'coinpay-mcp',
      });
      return { ...text({ banks: results }), isError: false };
    },
  },
];

/** Answer one JSON-RPC message; null for a notification. */
export async function handleMessage(message, ctx) {
  const { id, method, params = {} } = message || {};
  const reply = (result) => (id === undefined ? null : { jsonrpc: '2.0', id, result });
  const fail = (code, msg) => (id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message: msg } });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'coinpay', version: ctx.version || '0.0.0' },
        instructions:
          'CoinPay finances. Statement PDFs come from the banks themselves (SimpleFIN has none): statements_coverage shows what is missing, statements_fetch downloads what is new on this machine. A bank marked login_needed needs a person to run `coinpay finances statements login <bank>`.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params.name}`);
      try {
        const client = await ctx.getClient();
        return reply(await tool.handler(params.arguments || {}, { ...ctx, client }));
      } catch (err) {
        return reply({ ...text(`${err && err.message ? err.message : String(err)}${err && err.code ? ` (${err.code})` : ''}`), isError: true });
      }
    }
    default:
      return id === undefined ? null : fail(-32601, `Method not found: ${method}`);
  }
}

/** Serve on stdin/stdout until stdin closes. Calls run concurrently; replies carry their id. */
export async function serveStdio({ getClient, version, home = sf.statementsHome(), input = process.stdin, output = process.stdout, errOut = (line) => process.stderr.write(`${line}\n`) }) {
  const ctx = { getClient, version, home, log: errOut };
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      continue;
    }
    const task = handleMessage(message, ctx).then((response) => {
      if (response) output.write(`${JSON.stringify(response)}\n`);
    });
    pending.add(task);
    task.finally(() => pending.delete(task));
  }
  await Promise.all(pending);
}
