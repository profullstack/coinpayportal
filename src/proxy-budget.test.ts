import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import * as budget from './lib/explorer-budget';
import * as gateway from './lib/explorer-gateway';
import * as identity from './lib/explorer-identity';
import * as abuse from './lib/explorer-abuse';
import * as watch from './lib/explorer-watch';

const request = (ip?: string, headers: Record<string, string> = {}, path = '/explorer/sol/tx/hash') =>
  new NextRequest(`https://coinpayportal.com${path}`, {
    headers: { ...(ip ? { 'x-forwarded-for': ip } : {}), ...headers },
  });
afterEach(() => vi.restoreAllMocks());

describe('shared budget in the security proxy', () => {
  it('stops a fleet rotating IPs, paths and fabricated credentials', async () => {
    vi.spyOn(budget, 'reserveExplorerRead').mockImplementation(budget.createExplorerBudget({ dailyLimit: 3 }));
    const gate = vi.spyOn(gateway, 'explorerGate').mockImplementation(async () => new Response('Pay', { status: 402 }));
    for (let i = 0; i < 3; i++) {
      const response = await proxy(request(`198.51.100.${i}`, { 'x-api-key': `fake-${i}` }, `/explorer/xrp/tx/${i}`));
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
    const response = await proxy(request('203.0.113.200', { authorization: 'Bearer invented', cookie: 'token=invented' }));
    expect(response.status).toBe(402);
    expect(response.headers.has('x-middleware-next')).toBe(false);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it.each(['daily', 'burst', 'unavailable'] as const)('gates unidentified callers on shared %s refusal', async reason => {
    vi.spyOn(budget, 'reserveExplorerRead').mockReturnValue(reason);
    vi.spyOn(gateway, 'explorerGate').mockResolvedValue(new Response('Pay', { status: 402 }));
    const refused = vi.spyOn(watch, 'countExplorerRefusal');
    expect((await proxy(request())).status).toBe(402);
    expect(refused).toHaveBeenCalledWith(`shared-${reason}`);
  });

  it('allows the gateway to verify a paid pass after exhaustion', async () => {
    vi.spyOn(budget, 'reserveExplorerRead').mockReturnValue('daily');
    vi.spyOn(gateway, 'explorerGate').mockResolvedValue(null);
    expect((await proxy(request('203.0.113.201', { 'x-explorer-pass': 'verified-by-gateway' }))).headers.get('x-middleware-next')).toBe('1');
  });

  it('keeps unrelated pages outside the shared budget', async () => {
    const reserve = vi.spyOn(budget, 'reserveExplorerRead').mockReturnValue('daily');
    expect((await proxy(request('203.0.113.202', {}, '/pricing'))).status).toBe(200);
    expect(reserve).not.toHaveBeenCalled();
  });
});

it('gives a verified account its own allowance after the anonymous pool is exhausted', async () => {
  vi.spyOn(identity, 'explorerAccount').mockReturnValue('merchant-123');
  const anonymous = vi.spyOn(budget, 'reserveExplorerRead').mockReturnValue('daily');
  const personal = vi.spyOn(budget, 'reserveExplorerAccountRead').mockReturnValue('allowed');
  const response = await proxy(request('203.0.113.205'));
  expect(response.headers.get('x-middleware-next')).toBe('1');
  expect(personal).toHaveBeenCalledWith('merchant-123');
  expect(anonymous).not.toHaveBeenCalled();
});

it('does not let a paid pass override an abuse ban', async () => {
  vi.spyOn(abuse, 'checkExplorerAbuse').mockReturnValue({ blocked: true, fingerprint: 'blocked' });
  const paid = vi.spyOn(gateway, 'explorerGate').mockResolvedValue(null);
  const response = await proxy(request('203.0.113.206', { 'x-explorer-pass': 'paid' }));
  expect(response.status).toBe(403);
  expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(paid).not.toHaveBeenCalled();
});
