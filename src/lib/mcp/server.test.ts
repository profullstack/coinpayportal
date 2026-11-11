import { describe, it, expect, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));

import { handleMessage, listTools, type ServerContext } from './server';
import { MCP_TOOLS, checkArgs } from './tools';
import { matchRoute, McpApiError } from './dispatch';
// The stdio server the remote tools are taken from.
import { TOOLS as SDK_TOOLS } from '../../../packages/sdk/src/mcp.js';

const USER = '11111111-1111-4111-8111-111111111111';
const BIZ = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

const INCLUDED = [
  'invoice_list', 'invoice_get', 'invoice_create_draft', 'invoice_ar_aging',
  'project_list', 'project_get', 'time_log', 'project_invoice_time',
  'contractor_list', 'contractor_get', 'contractor_work_list',
  'pay_run_list', 'pay_run_get', 'document_list', 'document_get',
];

function ctxWith(responses: Record<string, unknown> = {}, businesses = [{ id: BIZ, name: 'Acme' }]) {
  const calls: Array<{ endpoint: string; options: any }> = [];
  const ctx: ServerContext = {
    userId: USER,
    client: {
      request: vi.fn(async (endpoint: string, options: any = {}) => {
        calls.push({ endpoint, options });
        const key = `${(options.method || 'GET').toUpperCase()} ${endpoint.split('?')[0]}`;
        if (!(key in responses)) throw new McpApiError(`no fake for ${key}`, 404);
        return responses[key];
      }),
    },
    businesses: async () => businesses,
    rateLimit: async () => true,
  };
  return { ctx, calls };
}

describe('tool surface', () => {
  it('is exactly the invoices + projects set', () => {
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual([...INCLUDED].sort());
  });

  it('never exposes finances, statements, tax documents, 1099s, pay run drafts, work review or document void', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    for (const n of names) expect(n).not.toMatch(/^(finance_|statements_|tax_documents_)/);
    for (const n of ['contractor_1099_summary', 'pay_run_draft', 'contractor_work_review', 'document_void']) {
      expect(names).not.toContain(n);
    }
  });

  it('gives every tool a title and all four annotations, and marks only the three creators as writes', () => {
    for (const t of listTools()) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.annotations.title).toBe(t.title);
      for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
        expect(typeof t.annotations[k], `${t.name}.${k}`).toBe('boolean');
      }
      expect(t.annotations.destructiveHint).toBe(false);
      expect(t.annotations.openWorldHint).toBe(false);
    }
    const writes = listTools().filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort();
    expect(writes).toEqual(['invoice_create_draft', 'project_invoice_time', 'time_log']);
  });

  it('keeps the SDK stdio schemas (only the businessId hint differs)', () => {
    const strip = (s: any) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'businessId' ? { type: 'string' } : v)));
    for (const t of MCP_TOOLS) {
      const sdk = (SDK_TOOLS as any[]).find((s) => s.name === t.name);
      expect(sdk, t.name).toBeTruthy();
      expect(strip(t.inputSchema), t.name).toEqual(strip(sdk.inputSchema));
      expect(t.description).toContain(sdk.description.slice(0, 40));
    }
  });
});

describe('JSON-RPC', () => {
  it('initialize echoes a supported protocol version and names the server', async () => {
    const { ctx } = ctxWith();
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ctx);
    expect(r.result.protocolVersion).toBe('2025-06-18');
    expect(r.result.serverInfo.name).toBe('coinpay');
    expect(r.result.capabilities.tools).toBeTruthy();
    const odd: any = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, ctx);
    expect(odd.result.protocolVersion).toBe('2025-06-18');
  });

  it('tools/list carries resultType, ttlMs and cacheScope', async () => {
    const { ctx } = ctxWith();
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx);
    expect(r.result.resultType).toBe('complete');
    expect(typeof r.result.ttlMs).toBe('number');
    expect(r.result.cacheScope).toBe('private');
    expect(r.result.tools).toHaveLength(INCLUDED.length);
  });

  it('notifications and client responses get no reply; unknown methods -32601', async () => {
    const { ctx } = ctxWith();
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull();
    expect(await handleMessage({ jsonrpc: '2.0', id: 5, result: {} } as any, ctx)).toBeNull();
    expect(await handleMessage({ jsonrpc: '2.0', id: 1, method: 'ping' }, ctx)).toMatchObject({ result: {} });
    expect(await handleMessage({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, ctx)).toMatchObject({ error: { code: -32601 } });
    expect(await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'finance_summary' } }, ctx)).toMatchObject({ error: { code: -32602 } });
  });

  it('fills businessId for a single-business user', async () => {
    const { ctx, calls } = ctxWith({ 'GET /projects': { projects: [{ id: ID, name: 'Site' }] } });
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'project_list', arguments: {} } }, ctx);
    expect(r.result.isError).toBe(false);
    expect(calls[0].endpoint).toBe(`/projects?business_id=${BIZ}`);
    expect(JSON.parse(r.result.content[0].text).projects[0].name).toBe('Site');
  });

  it('lists the businesses when a multi-business user leaves businessId out', async () => {
    const { ctx, calls } = ctxWith({}, [{ id: BIZ, name: 'Acme' }, { id: ID, name: 'Beta' }]);
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'contractor_list', arguments: {} } }, ctx);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain(`Acme: ${BIZ}`);
    expect(r.result.content[0].text).toContain(`Beta: ${ID}`);
    expect(calls).toHaveLength(0);
  });

  it('invoice_create_draft posts a draft with only the allowed fields', async () => {
    const { ctx, calls } = ctxWith({ 'POST /invoices': { success: true, invoice: { id: ID, status: 'draft' } } });
    const r: any = await handleMessage({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'invoice_create_draft', arguments: { lineItems: [{ description: 'Work', quantity: 2, unit_price: 50 }] } },
    }, ctx);
    expect(r.result.isError).toBe(false);
    const body = JSON.parse(calls[0].options.body);
    expect(body).toMatchObject({ business_id: BIZ, currency: 'USD', line_items: [{ description: 'Work', quantity: 2, unit_price: 50 }] });
    expect(body).not.toHaveProperty('merchant_wallet_address');
    expect(body).not.toHaveProperty('schedule');
  });

  it('refuses extra arguments such as a payout address before calling anything', async () => {
    const { ctx, calls } = ctxWith();
    const r: any = await handleMessage({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'invoice_create_draft', arguments: { lineItems: [{ description: 'x', quantity: 1, unit_price: 1 }], merchantWalletAddress: '0xabc' } },
    }, ctx);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/merchantWalletAddress is not a known argument/);
    expect(calls).toHaveLength(0);
  });

  it('answers isError when the per-user rate limit is spent', async () => {
    const { ctx, calls } = ctxWith();
    ctx.rateLimit = async () => false;
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'invoice_get', arguments: { id: ID } } }, ctx);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/Rate limit/);
    expect(calls).toHaveLength(0);
  });

  it('document_get drops the wrapped key', async () => {
    const { ctx } = ctxWith({ [`GET /documents/${ID}`]: { document: { id: ID, title: 'NDA', wrapped_key: 'secret' }, recipients: [], events: [] } });
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'document_get', arguments: { id: ID } } }, ctx);
    expect(r.result.content[0].text).not.toContain('wrapped_key');
    expect(r.result.content[0].text).toContain('NDA');
  });
});

describe('checkArgs', () => {
  const schema = MCP_TOOLS.find((t) => t.name === 'time_log')!.inputSchema;
  it('checks required, types and bounds', () => {
    expect(checkArgs(schema, { projectId: ID, minutes: 30 })).toBeNull();
    expect(checkArgs(schema, { minutes: 30 })).toMatch(/projectId is required/);
    expect(checkArgs(schema, { projectId: ID, minutes: 1.5 })).toMatch(/whole number/);
    expect(checkArgs(schema, { projectId: ID, minutes: 0 })).toMatch(/at least 1/);
    expect(checkArgs(schema, { projectId: ID, minutes: '30' })).toMatch(/must be a number/);
    expect(checkArgs(schema, [])).toMatch(/must be an object/);
  });
});

describe('dispatch allowlist', () => {
  it('routes the tools’ endpoints', () => {
    expect(matchRoute('GET', '/invoices?business_id=x')).toBeTruthy();
    expect(matchRoute('GET', '/invoices/aging?business_id=x')?.id).toBeNull();
    expect(matchRoute('GET', `/invoices/${ID}`)?.id).toBe(ID);
    expect(matchRoute('POST', '/invoices')).toBeTruthy();
    expect(matchRoute('POST', '/time-entries')).toBeTruthy();
    expect(matchRoute('POST', `/projects/${ID}/invoice`)?.id).toBe(ID);
    expect(matchRoute('GET', `/documents/${ID}`)).toBeTruthy();
  });

  it('refuses sends, payments, pay-run writes, deletes, voids and anything off the list', () => {
    for (const [method, endpoint] of [
      ['POST', `/invoices/${ID}/send`],
      ['PUT', `/invoices/${ID}`],
      ['DELETE', `/invoices/${ID}`],
      ['POST', '/pay-runs'],
      ['POST', `/pay-runs/${ID}/pay`],
      ['PATCH', `/documents/${ID}`],
      ['PATCH', `/contractor-work-items/${ID}`],
      ['GET', '/contractors/1099'],
      ['POST', '/payouts/create'],
      ['GET', '/finances/summary'],
      ['GET', `/invoices/${ID}/../../payouts`],
      ['GET', `/invoices/..%2fpayouts`],
      ['GET', '//evil.example/invoices'],
      ['GET', 'https://evil.example/invoices'],
      ['GET', '/invoices/not-a-uuid'],
    ]) {
      expect(matchRoute(method, endpoint), `${method} ${endpoint}`).toBeNull();
    }
  });
});
