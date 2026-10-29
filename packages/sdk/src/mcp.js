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
import * as contractors from './contractors.js';
import * as documents from './documents.js';

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
    name: 'finance_declared_costs',
    description: 'Declared recurring costs: bills no bank feed shows (servers paid by PayPal or crypto), stated by the owner, e.g. from an OpenDevice inventory. They are merged into finance_recurring (origin "declared", or "matched" when a feed charge is the same bill).',
    inputSchema: { type: 'object', properties: { source: { type: 'string', description: 'Only this source, e.g. opendevice' } }, additionalProperties: false },
    handler: async (args, { client }) => text(await reports.listDeclaredCosts(client, { source: args.source })),
  },
  {
    name: 'finance_import_costs',
    description: 'Replace one source\'s declared recurring costs. Pass an OpenDevice inventory (an object with "devices"; the server converts it) or an array of @profullstack/fleet toCoinPayCosts rows. An empty array clears the source.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source name (default opendevice)' },
        inventory: { type: 'object', description: 'An OpenDevice inventory' },
        costs: { type: 'array', items: { type: 'object' }, description: 'toCoinPayCosts rows' },
      },
      additionalProperties: false,
    },
    handler: async (args, { client }) => {
      const body = args.inventory ?? args.costs;
      if (body === undefined) throw new Error('Pass inventory or costs');
      return text(await reports.importDeclaredCosts(client, body, { source: args.source || 'opendevice' }));
    },
  },
  {
    name: 'finance_goals',
    description: 'Savings and payoff goals (buy a house or car, emergency fund, pay off debt): each with progress, percent, on track/behind/achieved/past deadline, and what it takes per day/week/month/quarter to finish by the deadline. Not financial advice.',
    inputSchema: { type: 'object', properties: { archived: { type: 'boolean', description: 'Include archived goals' } }, additionalProperties: false },
    handler: async (args, { client }) => text(await reports.listGoals(client, { archived: args.archived === true })),
  },
  {
    name: 'finance_goal_create',
    description: 'Create a goal. kind: house, car, emergency_fund, debt_payoff or custom. Link finance account ids (finance_accounts; debt accounts for a payoff goal) or web wallet ids so progress follows real balances; otherwise progress is startingAmount plus recorded contributions. A payoff goal linked to debt accounts with no startingAmount starts at what they owe now.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: ['house', 'car', 'emergency_fund', 'debt_payoff', 'custom'] },
        targetAmount: { type: ['number', 'string'] },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: 'Default USD' },
        startDate: { type: 'string', description: 'YYYY-MM-DD, default today' },
        startingAmount: { type: ['number', 'string'], description: 'Already saved (save goal) or the debt at the start (payoff goal)' },
        linkedAccountIds: { type: 'array', items: { type: 'string' } },
        linkedWalletIds: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['name', 'kind', 'deadline'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => text({ goal: await reports.createGoal(client, args) }),
  },
  {
    name: 'finance_goal_update',
    description: 'Edit a goal (any field), choose which linked accounts/wallets count (the full list replaces the old one; [] unlinks all), or archive/unarchive it. Archived goals are hidden from finance_goals unless archived=true and left out of reports and the goals email. Each goal\'s `sources` lists what its progress is made of.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string', enum: ['house', 'car', 'emergency_fund', 'debt_payoff', 'custom'] },
        targetAmount: { type: ['number', 'string'] },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string' },
        startingAmount: { type: ['number', 'string', 'null'] },
        linkedAccountIds: { type: 'array', items: { type: 'string' } },
        linkedWalletIds: { type: 'array', items: { type: 'string' } },
        notes: { type: ['string', 'null'] },
        archived: { type: 'boolean' },
      },
      required: ['goalId'],
      additionalProperties: false,
    },
    handler: async ({ goalId, ...patch }, { client }) => text({ goal: await reports.updateGoal(client, goalId, patch) }),
  },
  {
    name: 'finance_goal_delete',
    description: 'Delete a goal and its recorded contributions for good. Prefer finance_goal_update with archived=true to keep it.',
    inputSchema: { type: 'object', properties: { goalId: { type: 'string' } }, required: ['goalId'], additionalProperties: false },
    handler: async (args, { client }) => text(await reports.deleteGoal(client, args.goalId)),
  },
  {
    name: 'finance_goal_contribute',
    description: 'Record an amount put toward a goal, or a payment on a payoff goal (negative = withdrawal). Records only; moves no money.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
        amount: { type: ['number', 'string'] },
        occurredOn: { type: 'string', description: 'YYYY-MM-DD, default today' },
        note: { type: 'string' },
      },
      required: ['goalId', 'amount'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => text({ contribution: await reports.addGoalContribution(client, args.goalId, { amount: args.amount, occurredOn: args.occurredOn, note: args.note }) }),
  },
  {
    name: 'finance_goals_report',
    description: 'The goals progress report for the trailing day, week, month or quarter: each goal\'s change in the period, what the period needed to stay on schedule, pace (ahead/on pace/short), and overall status.',
    inputSchema: { type: 'object', properties: { period: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly'] } }, additionalProperties: false },
    handler: async (args, { client }) => text((await reports.getGoalsReport(client, { period: args.period || 'weekly' })).text),
  },
  {
    name: 'finance_goals_digest',
    description: 'The opt-in goals report email: show it, turn it on at a cadence (daily, weekly, monthly, quarterly; optional hour 0-23 and recipients), turn it off, or send one now.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'on', 'off', 'send_now'] },
        cadence: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly'] },
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        to: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      },
      required: ['action'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => {
      if (args.action === 'on') return text({ schedule: await reports.setGoalsDigest(client, { cadence: args.cadence, hour: args.hour, recipients: args.to }) });
      if (args.action === 'off') return text(await reports.deleteGoalsDigest(client));
      if (args.action === 'send_now') return text(await reports.sendGoalsDigestNow(client));
      return text({ schedule: await reports.getGoalsDigest(client) });
    },
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
    description: 'The daily summary email (spend vs a $/day target, top cuts, due soon, new activity, position): show it, turn it on (optionally hour 0-23 and recipients), turn it off, send one now, or set_target (target in $/day, null clears).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'on', 'off', 'send_now', 'set_target'] },
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        to: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        target: { type: ['number', 'null'], minimum: 0 },
      },
      required: ['action'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => {
      if (args.action === 'on') return text({ schedule: await reports.setDailySummary(client, { hour: args.hour, recipients: args.to, active: true }) });
      if (args.action === 'off') return text(await reports.deleteDailySummary(client));
      if (args.action === 'send_now') return text(await reports.sendDailySummaryNow(client));
      if (args.action === 'set_target') return text(await reports.setDailySpendTarget(client, args.target ?? null));
      return text(await reports.getDailySummaryWithTarget(client));
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
  // Contractors. None of these sends money: paying a run is a signed-in owner's act in the dashboard or CLI.
  {
    name: 'contractor_list',
    description: 'List contractors with wallet and tax-form status and how many submissions wait for approval.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' }, includeOffboarded: { type: 'boolean' } }, additionalProperties: false },
    handler: async (args, { client }) => text({ contractors: await contractors.listContractors(client, args) }),
  },
  {
    name: 'contractor_get',
    description: 'One contractor: contracts and milestones, work lines and payments.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: async (args, { client }) => text(await contractors.getContractor(client, args.id)),
  },
  {
    name: 'contractor_work_list',
    description: 'Contractor work lines (hours, milestones, expenses, bonuses, fixed fees). Use status "submitted" for what waits for approval.',
    inputSchema: {
      type: 'object',
      properties: {
        businessId: { type: 'string' },
        status: { type: 'string', enum: ['submitted', 'approved', 'rejected', 'paid'] },
        contractorId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, { client }) => text({ work_items: await contractors.listWorkItems(client, args) }),
  },
  {
    name: 'contractor_work_review',
    description: 'Approve or reject a submitted work line. A rejection needs a note the contractor will see. Approving does not pay; it queues the line for the next pay run.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, action: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string' } },
      required: ['id', 'action'],
      additionalProperties: false,
    },
    handler: async (args, { client }) => text({ work_item: await contractors.reviewWorkItem(client, args.id, args) }),
  },
  {
    name: 'pay_run_list',
    description: 'Pay runs with totals and how many contractors are paid.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' } }, additionalProperties: false },
    handler: async (args, { client }) => text({ pay_runs: await contractors.listPayRuns(client, args) }),
  },
  {
    name: 'pay_run_get',
    description: 'One pay run: per-contractor amounts, lines, status and warnings (missing or recently changed wallets).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: async (args, { client }) => text(await contractors.getPayRun(client, args.id)),
  },
  {
    name: 'pay_run_draft',
    description: 'Draft a pay run from fixed fees due by payDate (YYYY-MM-DD, default today) plus all approved work. Sends nothing; the owner reviews and pays it.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' }, payDate: { type: 'string' } }, additionalProperties: false },
    handler: async (args, { client }) => text({ pay_run: await contractors.createPayRun(client, args) }),
  },
  {
    name: 'contractor_1099_summary',
    description: 'Totals paid per contractor in a calendar year and who needs a 1099-NEC (US, $600+, not a corporation). Shows only the last four of tax ids.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' }, year: { type: 'integer' } }, additionalProperties: false },
    handler: async (args, { client }) => text(await contractors.get1099Summary(client, args)),
  },
  // Documents are end-to-end encrypted. These tools see only metadata and the
  // audit trail; opening, uploading or sharing a file needs the passphrase,
  // which stays with a person (dashboard or `coinpay document`), never an agent.
  {
    name: 'document_list',
    description: 'List documents with status (draft, shared, out_for_signature, completed, declined, voided) and signing progress. Contents are end-to-end encrypted and not available here.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' }, status: { type: 'string' } }, additionalProperties: false },
    handler: async (args, { client }) => text({ documents: await documents.listDocuments(client, args) }),
  },
  {
    name: 'document_get',
    description: 'One document: who it was sent to, who signed (name, time, IP), and the full audit trail. No file contents or keys.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: async (args, { client }) => {
      const { document, recipients, events } = await documents.getDocument(client, args.id);
      const { wrapped_key: _k, ...meta } = document;
      return text({ document: meta, recipients, events });
    },
  },
  {
    name: 'document_void',
    description: 'Void a document that has not been completed: links stop working and nobody can sign it. Cannot be undone.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: async (args, { client }) => text(await documents.voidDocument(client, args.id, { reason: args.reason })),
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
          'CoinPay finances. finance_due_soon answers "what is due" across every account; finance_recurring lists subscriptions and bills (declared costs such as servers paid by PayPal included, see finance_declared_costs); finance_summary is the balance sheet. Statement PDFs come from the banks themselves (SimpleFIN has none): statements_coverage shows what is missing, statements_fetch downloads what is new on this machine. A bank marked login_needed needs a person to run `coinpay finances statements login <bank>`. Tax notices, letters and transcripts (California FTB, IRS) are in tax_documents_list; tax data stays on CoinPay surfaces and is never sent elsewhere.',
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
