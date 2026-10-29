/**
 * `coinpay mcp`: the JSON-RPC surface, in process and over a real stdio pipe.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleMessage, TOOLS } from '../src/mcp.js';

const ctx = (client) => ({ version: '9.9.9', home: mkdtempSync(join(tmpdir(), 'coinpay-mcp-')), log: () => {}, getClient: async () => client });

describe('handleMessage', () => {
  it('initializes with tools and echoes the protocol version', async () => {
    const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ctx({}));
    expect(res.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'coinpay', version: '9.9.9' } });
  });

  it('ignores notifications and rejects unknown methods', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx({}))).toBeNull();
    expect((await handleMessage({ jsonrpc: '2.0', id: 2, method: 'nope' }, ctx({}))).error.code).toBe(-32601);
  });

  it('lists the statement tools with schemas', async () => {
    const res = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctx({}));
    const names = res.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['statements_coverage', 'statements_fetch', 'statements_banks', 'statements_list', 'finance_accounts']));
    for (const tool of res.result.tools) expect(tool.inputSchema.type).toBe('object');
    expect(TOOLS.every((t) => typeof t.handler === 'function')).toBe(true);
  });

  it('goal tools hit the goals API', async () => {
    const calls = [];
    const client = { request: async (endpoint, options = {}) => { calls.push([options.method || 'GET', endpoint]); return endpoint.includes('report') ? { report: {}, text: 'Monthly goals report' } : { goal: { id: 'g' }, goals: [] }; } };
    const report = await handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'finance_goals_report', arguments: { period: 'monthly' } } }, ctx(client));
    expect(report.result.content[0].text).toBe('Monthly goals report');
    await handleMessage({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'finance_goal_create', arguments: { name: 'Car', kind: 'car', targetAmount: 20000, deadline: '2028-01-01' } } }, ctx(client));
    expect(calls).toEqual([['GET', '/finances/goals/report?period=monthly'], ['POST', '/finances/goals']]);
  });

  it('goal update and delete tools PATCH and DELETE the goal', async () => {
    const calls = [];
    const client = { request: async (endpoint, options = {}) => { calls.push([options.method || 'GET', endpoint, options.body ? JSON.parse(options.body) : null]); return { goal: { id: 'g' }, success: true }; } };
    await handleMessage({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'finance_goal_update', arguments: { goalId: 'g', linkedAccountIds: [], archived: true } } }, ctx(client));
    await handleMessage({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'finance_goal_delete', arguments: { goalId: 'g' } } }, ctx(client));
    expect(calls).toEqual([['PATCH', '/finances/goals/g', { linkedAccountIds: [], archived: true }], ['DELETE', '/finances/goals/g', null]]);
  });

  it('calls the API through the client and returns JSON text', async () => {
    const calls = [];
    const client = { request: async (endpoint) => { calls.push(endpoint); return { months: ['2026-10'], accounts: [], missing: 0, fetchers: [] }; } };
    const res = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'statements_coverage', arguments: { months: 6 } } }, ctx(client));
    expect(calls).toEqual(['/finances/statements/coverage?months=6']);
    expect(JSON.parse(res.result.content[0].text)).toMatchObject({ missing: 0 });
  });

  it('carries the cache fields Claude Code requires on tools/list', async () => {
    const res = await handleMessage({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, ctx({}));
    expect(res.result).toMatchObject({ resultType: 'complete', ttlMs: 0, cacheScope: 'private' });
    const names = res.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['finance_due_soon', 'finance_recurring', 'finance_summary', 'finance_transactions', 'finance_set_due_day', 'finance_daily_summary']));
  });

  it('answers finance_due_soon from the due-soon route', async () => {
    const calls = [];
    const client = {
      request: async (endpoint) => {
        calls.push(endpoint);
        return { dueSoon: { today: '2026-10-12', items: [{ payee: 'Netflix', amount: 26.99 }], totals: { due: 26.99 }, recurring: { charges: [], monthlyTotal: 400 } } };
      },
    };
    const res = await handleMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'finance_due_soon', arguments: { days: 14 } } }, ctx(client));
    expect(calls).toEqual(['/finances/due-soon?days=14']);
    const body = JSON.parse(res.result.content[0].text);
    expect(body.items[0].payee).toBe('Netflix');
    expect(body.recurringMonthlyTotal).toBe(400);
    expect(body.recurring).toBeUndefined();
  });

  it('turns the daily summary on through the schedules route', async () => {
    const calls = [];
    const client = { request: async (endpoint, init) => { calls.push([endpoint, init?.method, init?.body && JSON.parse(init.body)]); return { schedule: { kind: 'daily_summary', active: true } }; } };
    await handleMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'finance_daily_summary', arguments: { action: 'on', hour: 7 } } }, ctx(client));
    expect(calls[0][0]).toBe('/finances/email-schedules');
    expect(calls[0][1]).toBe('POST');
    expect(calls[0][2]).toMatchObject({ kind: 'daily_summary', hour: 7, active: true });
  });

  it('reports a tool failure as an error result, not a protocol error', async () => {
    const res = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'statements_list', arguments: {} } }, { ...ctx(null), getClient: async () => { throw new Error('Not logged in'); } });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/Not logged in/);
  });
});

describe('coinpay mcp over stdio', () => {
  it('answers initialize and tools/list on stdout, one JSON line each', { timeout: 30_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'coinpay-mcp-home-'));
    const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'bin', 'coinpay.js'), 'mcp'], { env: { ...process.env, HOME: home, COINPAY_SESSION_TOKEN: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    child.stdin.end();
    await new Promise((resolve) => child.on('exit', resolve));
    const messages = stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(messages.map((m) => m.id)).toEqual([1, 2]);
    expect(messages[1].result.tools.length).toBeGreaterThanOrEqual(6);
  });
});
