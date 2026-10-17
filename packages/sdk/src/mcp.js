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
import { getFinanceSummary, listFinanceAccounts, listFinanceTransactions } from './finances.js';
import * as sf from './statements-fetch.js';
import { listInvoices, getInvoice, createInvoice } from './invoices.js';
import * as projects from './projects.js';

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
    name: 'finance_due_soon',
    description:
      'What is due across every linked account: overdue, today and the next N days. Projected from each recurring charge\'s own cadence, plus statement due days set on cards and loans. Also lists charges that stopped appearing ("missed") and paid-this-cycle statements.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 0, maximum: 60, description: 'Horizon in days (default 7)' },
        timezone: { type: 'string', description: 'IANA zone for "today"; defaults to the saved finance timezone' },
      },
      additionalProperties: false,
    },
    handler: async (args, { client }) => {
      const { recurring, ...due } = await reports.getDueSoon(client, { days: args.days, timezone: args.timezone });
      return text({ ...due, recurringMonthlyTotal: recurring.monthlyTotal });
    },
  },
  {
    name: 'finance_recurring',
    description: 'Every recurring charge detected across all accounts (subscriptions, bills, loan and card payments): cadence, typical amount, last and next date, monthly equivalent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { client }) => text((await reports.getDueSoon(client, { days: 0 })).recurring),
  },
  {
    name: 'finance_summary',
    description: 'Balance sheet (assets, debt, net by currency), cashflow for the window, top spending categories, and the debt-and-income position.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 3650, description: 'Cashflow window (default 30)' } }, additionalProperties: false },
    handler: async (args, { client }) => text(await getFinanceSummary(client, { days: args.days || 30 })),
  },
  {
    name: 'finance_transactions',
    description: 'The bank and card ledger, newest first. Filter by account id, text search, category or date range (YYYY-MM-DD).',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'string' },
        search: { type: 'string' },
        category: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        offset: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    handler: async (args, { client }) => text(await listFinanceTransactions(client, { ...args, limit: args.limit || 50 })),
  },
  {
    name: 'finance_set_due_day',
    description: 'Set or clear a card or loan\'s statement due day (1-31, null clears) and optionally a fixed monthly amount (null = statement balance). Puts the account on the due-soon list.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'string' },
        day: { type: ['integer', 'null'], minimum: 1, maximum: 31 },
        amount: { type: ['number', 'string', 'null'] },
      },
      required: ['accountId', 'day'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => text({ account: await reports.setAccountDueDay(client, args.accountId, { day: args.day, amount: args.amount }) }),
  },
  {
    name: 'finance_daily_summary',
    description: 'The daily summary email (due soon, new activity, position): show it, turn it on (optionally hour 0-23 and recipients), turn it off, or send one now.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'on', 'off', 'send_now'] },
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        to: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      },
      required: ['action'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => {
      if (args.action === 'on') return text({ schedule: await reports.setDailySummary(client, { hour: args.hour, recipients: args.to, active: true }) });
      if (args.action === 'off') return text(await reports.deleteDailySummary(client));
      if (args.action === 'send_now') return text(await reports.sendDailySummaryNow(client));
      return text({ schedule: await reports.getDailySummary(client) });
    },
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
        // FTB and IRS need no linked bank; each is throttled (2 visits / 30 min, 4 / day).
        taxSources: sf.standaloneSources().filter((s) => s.kind === 'tax').map((s) => ({ key: s.key, name: s.name, signedIn: sf.signedIn(s.key, home), throttle: sf.checkLocalThrottle(home, s.key), ...state.institutions[s.key] })),
        // Brokerages with no linked account (Webull): statements, confirmations and 1099s go to Documents.
        brokerages: sf.standaloneSources().filter((s) => s.kind === 'brokerage' && !institutions.some((i) => i.key === s.key)).map((s) => ({ key: s.key, name: s.name, signedIn: sf.signedIn(s.key, home), ...state.institutions[s.key] })),
      });
    },
  },
  {
    name: 'tax_documents_list',
    description:
      'Tax documents in the CoinPay document library: notices, letters and transcripts fetched from California FTB and the IRS (or uploaded), with tax year, type, source and period. Details only, not the files. Optionally one tax year or one source (ftb, irs, irs-business).',
    inputSchema: {
      type: 'object',
      properties: {
        taxYear: { type: 'integer', minimum: 1990, maximum: 2100 },
        source: { type: 'string', description: 'ftb, irs or irs-business' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
    handler: async (args, { client }) => {
      const documents = (await reports.listFinanceDocuments(client, { category: 'tax', limit: args.limit }))
        .filter((d) => args.taxYear === undefined || d.taxYear === args.taxYear)
        .filter((d) => args.source === undefined || d.institutionKey === args.source);
      return text({ documents });
    },
  },
  {
    name: 'tax_documents_get',
    description: 'One document from the CoinPay document library by id: title, type, tax year, source, period, size, and its download path in CoinPay.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: async (args, { client }) => text({ document: await reports.getFinanceDocument(client, args.id) }),
  },
  {
    name: 'statements_cloud_status',
    description:
      'CoinPay cloud statement fetching: whether this account has it (Professional plan, free for admins) and, per bank, whether a cloud session is connected, needs sign-in again, and when it last fetched. A bank must be connected by a person in the PWA or with `coinpay finances statements cloud connect <bank>`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { client }) => text(await reports.getCloudStatements(client)),
  },
  {
    name: 'statements_cloud_fetch',
    description: 'Queue a CoinPay cloud fetch of new PDF statements for one connected bank, or all of them. Runs on CoinPay servers; returns the jobs. Nothing runs on this machine.',
    inputSchema: {
      type: 'object',
      properties: { bank: { type: 'string', description: 'Bank key such as "chase"; every connected bank when omitted' } },
      additionalProperties: false,
    },
    handler: async (args, { client }) => text(await reports.fetchCloudStatements(client, { institutionKey: args.bank })),
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
  {
    name: 'invoice_list',
    description: 'List invoices (number, status, amount, currency, due date, client). Filter by status: draft, sent, overdue, paid, cancelled.',
    inputSchema: {
      type: 'object',
      properties: {
        businessId: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'sent', 'overdue', 'paid', 'cancelled'] },
        clientId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, { client }) => text(await listInvoices(client, args)),
  },
  {
    name: 'invoice_get',
    description: 'One invoice with its line items, totals, payment details and status.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: async (args, { client }) => text(await getInvoice(client, args.id)),
  },
  {
    name: 'invoice_create_draft',
    description:
      'Create a DRAFT itemised invoice (nothing is sent). lineItems: [{description, quantity, unit_price, tax_rate?, tax_name?}]; discount: {type: percent|fixed, value}. The server computes the total.',
    inputSchema: {
      type: 'object',
      properties: {
        businessId: { type: 'string' },
        clientId: { type: 'string' },
        currency: { type: 'string', description: 'ISO code, default USD' },
        dueDate: { type: 'string', description: 'ISO date' },
        notes: { type: 'string' },
        lineItems: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit_price: { type: 'number' },
              tax_rate: { type: 'number' },
              tax_name: { type: 'string' },
            },
            required: ['description', 'quantity', 'unit_price'],
            additionalProperties: false,
          },
        },
        discount: {
          type: 'object',
          properties: { type: { type: 'string', enum: ['percent', 'fixed'] }, value: { type: 'number' } },
          required: ['type', 'value'],
          additionalProperties: false,
        },
      },
      required: ['lineItems'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => text(await createInvoice(client, { ...args, currency: args.currency || 'USD' })),
  },
  {
    name: 'invoice_ar_aging',
    description: 'Accounts receivable aging: unpaid sent invoices by days past due (current, 1-30, 31-60, 61-90, 90+), per currency and per client.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' } }, additionalProperties: false },
    handler: async (args, { client }) => text(await projects.getArAging(client, args)),
  },
  {
    name: 'project_list',
    description: 'List active projects (name, client, hourly rate, budget).',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' }, includeArchived: { type: 'boolean' } }, additionalProperties: false },
    handler: async (args, { client }) => text({ projects: await projects.listProjects(client, args) }),
  },
  {
    name: 'project_get',
    description: 'One project with hours logged, unbilled value, billed and paid totals.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: async (args, { client }) => text(await projects.getProject(client, args.id)),
  },
  {
    name: 'time_log',
    description: 'Log finished time on a project, in minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        minutes: { type: 'integer', minimum: 1, maximum: 100000 },
        description: { type: 'string' },
        billable: { type: 'boolean' },
      },
      required: ['projectId', 'minutes'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => text({ time_entry: await projects.logTime(client, args) }),
  },
  {
    name: 'project_invoice_time',
    description: "Bill a project's unbilled billable time as a DRAFT itemised invoice (not sent). Returns the invoice number and amount.",
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'], additionalProperties: false },
    handler: async (args, { client }) => text(await projects.invoiceProjectTime(client, args.projectId)),
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
          'CoinPay finances. finance_due_soon answers "what is due" across every account; finance_recurring lists subscriptions and bills; finance_summary is the balance sheet. Statement PDFs come from the banks themselves (SimpleFIN has none): statements_coverage shows what is missing, statements_fetch downloads what is new on this machine. A bank marked login_needed needs a person to run `coinpay finances statements login <bank>`. Tax notices, letters and transcripts (California FTB, IRS) are in tax_documents_list; tax data stays on CoinPay surfaces and is never sent elsewhere.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      // Claude Code's client (revision 2026-07-28) rejects a whole list that
      // lacks these three cache fields, showing "tools fetch failed".
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), resultType: 'complete', ttlMs: 0, cacheScope: 'private' });
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
