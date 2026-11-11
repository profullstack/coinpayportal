/**
 * The remote MCP tools: invoices, projects, contractors, pay runs and
 * documents, for the signed-in CoinPay user.
 *
 * Schemas and handlers are the stdio server's (packages/sdk/src/mcp.js,
 * `coinpay mcp`), narrowed to what is safe to hand a remote model:
 * reads, plus three writes that only create records (a DRAFT invoice, a time
 * entry, a DRAFT invoice from unbilled time). Nothing here sends an invoice or
 * an email, approves work, drafts or pays a pay run, voids a document or
 * touches finances, statements or tax documents; those stay local
 * (`coinpay mcp`), and src/lib/mcp/dispatch.ts refuses their endpoints anyway.
 * tools.test.ts holds the schemas equal to the SDK's.
 */
import type { CoinPayClient } from '@profullstack/coinpay';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  getArAging,
  listProjects,
  getProject,
  logTime,
  invoiceProjectTime,
  listContractors,
  getContractor,
  listWorkItems,
  listPayRuns,
  getPayRun,
  listDocuments,
  getDocument,
} from '@profullstack/coinpay';
import type { InProcessClient } from './dispatch';

export type JsonSchema = {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
  additionalProperties: false;
};

export type ToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type ToolContext = {
  client: InProcessClient;
  /** Fill in businessId when the user has exactly one business; throws a helpful error otherwise. */
  businessId: (given: unknown) => Promise<string>;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
  /** Whether the route behind it needs a business id (filled in for single-business users). */
  needsBusiness?: boolean;
  handler: (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>;
};

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const sdk = (client: InProcessClient) => client as unknown as CoinPayClient;
const BUSINESS = { type: 'string', description: 'Business id. Optional when you have one business.' };

function tool(def: Omit<McpTool, 'annotations'> & { kind: 'read' | 'create' }): McpTool {
  const { kind, ...rest } = def;
  return { ...rest, annotations: { title: def.title, ...(kind === 'read' ? READ : CREATE) } };
}

export const MCP_TOOLS: McpTool[] = [
  tool({
    name: 'invoice_list',
    title: 'List invoices',
    kind: 'read',
    description:
      'List invoices (number, status, amount, currency, due date, client). Filter by status: draft, sent, overdue, paid, cancelled. Without businessId, lists every business you can see.',
    inputSchema: {
      type: 'object',
      properties: {
        businessId: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'sent', 'overdue', 'paid', 'cancelled'] },
        clientId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (args, { client }) => listInvoices(sdk(client), args),
  }),
  tool({
    name: 'invoice_get',
    title: 'Get an invoice',
    kind: 'read',
    description: 'One invoice with its line items, totals, payment details and status.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: (args, { client }) => getInvoice(sdk(client), args.id),
  }),
  tool({
    name: 'invoice_create_draft',
    title: 'Create a draft invoice',
    kind: 'create',
    needsBusiness: true,
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
    // Only these fields reach createInvoice: no payout address, coin, wallet or schedule.
    handler: (args, { client }) =>
      createInvoice(sdk(client), {
        businessId: args.businessId,
        clientId: args.clientId,
        currency: args.currency || 'USD',
        dueDate: args.dueDate,
        notes: args.notes,
        lineItems: args.lineItems,
        discount: args.discount,
      } as Parameters<typeof createInvoice>[1]),
  }),
  tool({
    name: 'invoice_ar_aging',
    title: 'Accounts receivable aging',
    kind: 'read',
    needsBusiness: true,
    description:
      'Accounts receivable aging: unpaid sent invoices by days past due (current, 1-30, 31-60, 61-90, 90+), per currency and per client.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' } }, additionalProperties: false },
    handler: (args, { client }) => getArAging(sdk(client), args),
  }),
  tool({
    name: 'project_list',
    title: 'List projects',
    kind: 'read',
    needsBusiness: true,
    description: 'List active projects (name, client, hourly rate, budget).',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' }, includeArchived: { type: 'boolean' } }, additionalProperties: false },
    handler: async (args, { client }) => ({ projects: await listProjects(sdk(client), args) }),
  }),
  tool({
    name: 'project_get',
    title: 'Get a project',
    kind: 'read',
    description: 'One project with hours logged, unbilled value, billed and paid totals.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: (args, { client }) => getProject(sdk(client), args.id),
  }),
  tool({
    name: 'time_log',
    title: 'Log time on a project',
    kind: 'create',
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
    handler: async (args, { client }) => ({
      time_entry: await logTime(sdk(client), {
        projectId: args.projectId,
        minutes: args.minutes,
        description: args.description,
        billable: args.billable,
      }),
    }),
  }),
  tool({
    name: 'project_invoice_time',
    title: 'Invoice unbilled project time',
    kind: 'create',
    description:
      "Bill a project's unbilled billable time as a DRAFT itemised invoice (not sent). Returns the invoice number and amount.",
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'], additionalProperties: false },
    handler: (args, { client }) => invoiceProjectTime(sdk(client), args.projectId),
  }),
  tool({
    name: 'contractor_list',
    title: 'List contractors',
    kind: 'read',
    needsBusiness: true,
    description: 'List contractors with wallet and tax-form status and how many submissions wait for approval.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' }, includeOffboarded: { type: 'boolean' } }, additionalProperties: false },
    handler: async (args, { client }) => ({ contractors: await listContractors(sdk(client), args) }),
  }),
  tool({
    name: 'contractor_get',
    title: 'Get a contractor',
    kind: 'read',
    description: 'One contractor: contracts and milestones, work lines and payments.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: (args, { client }) => getContractor(sdk(client), args.id),
  }),
  tool({
    name: 'contractor_work_list',
    title: 'List contractor work',
    kind: 'read',
    needsBusiness: true,
    description:
      'Contractor work lines (hours, milestones, expenses, bonuses, fixed fees). Use status "submitted" for what waits for approval.',
    inputSchema: {
      type: 'object',
      properties: {
        businessId: { type: 'string' },
        status: { type: 'string', enum: ['submitted', 'approved', 'rejected', 'paid'] },
        contractorId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, { client }) => ({ work_items: await listWorkItems(sdk(client), args) }),
  }),
  tool({
    name: 'pay_run_list',
    title: 'List pay runs',
    kind: 'read',
    needsBusiness: true,
    description: 'Pay runs with totals and how many contractors are paid.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' } }, additionalProperties: false },
    handler: async (args, { client }) => ({ pay_runs: await listPayRuns(sdk(client), args) }),
  }),
  tool({
    name: 'pay_run_get',
    title: 'Get a pay run',
    kind: 'read',
    description: 'One pay run: per-contractor amounts, lines, status and warnings (missing or recently changed wallets).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: (args, { client }) => getPayRun(sdk(client), args.id),
  }),
  tool({
    name: 'document_list',
    title: 'List documents',
    kind: 'read',
    needsBusiness: true,
    description:
      'List documents with status (draft, shared, out_for_signature, completed, declined, voided) and signing progress. Contents are end-to-end encrypted and not available here.',
    inputSchema: { type: 'object', properties: { businessId: { type: 'string' }, status: { type: 'string' } }, additionalProperties: false },
    handler: async (args, { client }) => ({ documents: await listDocuments(sdk(client), args) }),
  }),
  tool({
    name: 'document_get',
    title: 'Get a document',
    kind: 'read',
    description: 'One document: who it was sent to, who signed (name, time, IP), and the full audit trail. No file contents or keys.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: async (args, { client }) => {
      const { document, recipients, events } = await getDocument(sdk(client), args.id);
      const { wrapped_key: _k, ...meta } = document as typeof document & { wrapped_key?: unknown };
      return { document: meta, recipients, events };
    },
  }),
];

// Single-business users may leave businessId out; say so in the schema.
for (const t of MCP_TOOLS) {
  if (t.needsBusiness && t.inputSchema.properties.businessId) {
    t.inputSchema.properties.businessId = { ...BUSINESS };
  }
}

/** Check arguments against a tool's schema: required, unknown keys, primitive types, enums. */
export function checkArgs(schema: JsonSchema, args: unknown): string | null {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  return checkObject(schema, args as Record<string, unknown>, '');
}

function checkObject(schema: { properties: Record<string, any>; required?: string[] }, value: Record<string, unknown>, at: string): string | null {
  for (const key of schema.required ?? []) {
    if (value[key] === undefined || value[key] === null || value[key] === '') return `${at}${key} is required`;
  }
  for (const [key, v] of Object.entries(value)) {
    const prop = schema.properties[key];
    if (!prop) return `${at}${key} is not a known argument`;
    if (v === undefined || v === null) continue;
    const err = checkValue(prop, v, `${at}${key}`);
    if (err) return err;
  }
  return null;
}

function checkValue(prop: any, v: unknown, at: string): string | null {
  switch (prop.type) {
    case 'string':
      if (typeof v !== 'string') return `${at} must be a string`;
      if (v.length > 5000) return `${at} is too long`;
      break;
    case 'boolean':
      if (typeof v !== 'boolean') return `${at} must be true or false`;
      break;
    case 'number':
    case 'integer':
      if (typeof v !== 'number' || !Number.isFinite(v)) return `${at} must be a number`;
      if (prop.type === 'integer' && !Number.isInteger(v)) return `${at} must be a whole number`;
      if (prop.minimum !== undefined && v < prop.minimum) return `${at} must be at least ${prop.minimum}`;
      if (prop.maximum !== undefined && v > prop.maximum) return `${at} must be at most ${prop.maximum}`;
      break;
    case 'array':
      if (!Array.isArray(v)) return `${at} must be an array`;
      if (prop.minItems !== undefined && v.length < prop.minItems) return `${at} needs at least ${prop.minItems} item(s)`;
      if (prop.maxItems !== undefined && v.length > prop.maxItems) return `${at} allows at most ${prop.maxItems} items`;
      for (let i = 0; i < v.length; i++) {
        const err = checkValue(prop.items, v[i], `${at}[${i}]`);
        if (err) return err;
      }
      break;
    case 'object':
      if (!v || typeof v !== 'object' || Array.isArray(v)) return `${at} must be an object`;
      return checkObject(prop, v as Record<string, unknown>, `${at}.`);
  }
  if (prop.enum && !prop.enum.includes(v)) return `${at} must be one of ${prop.enum.join(', ')}`;
  return null;
}
