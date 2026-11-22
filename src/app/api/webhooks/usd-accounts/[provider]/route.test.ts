import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetUsdAccountProviderRegistry } from '@/lib/usd-accounts/providers';
import { MemoryUsdAccountStore } from '@/lib/usd-accounts/store';
import { STUB_SIGNATURE_HEADER, signStubWebhook } from '@/lib/usd-accounts/stub';

const store = new MemoryUsdAccountStore();
vi.mock('@/lib/usd-accounts/http', () => ({ usdAccountsDeps: () => ({ store }) }));

import { POST } from './route';

const originalEnv = process.env;

function call(provider: string, raw: string, headers: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost/api/webhooks/usd-accounts/${provider}`, {
    method: 'POST',
    body: raw,
    headers,
  });
  return POST(req, { params: Promise.resolve({ provider }) });
}

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: 'test' };
  resetUsdAccountProviderRegistry();
  store.events.clear();
});

afterEach(() => {
  process.env = originalEnv;
});

describe('POST /api/webhooks/usd-accounts/[provider]', () => {
  it('answers 503 {available:false} while the feature is dark', async () => {
    const res = await call('modern_treasury', '{}');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ available: false });
  });

  it('answers 503 for a provider that is not configured even with the flag on', async () => {
    process.env.USD_ACCOUNTS_ENABLED = '1';
    const res = await call('modern_treasury', '{}');
    expect(res.status).toBe(503);
  });

  it('rejects a bad signature with 401 and accepts a good one, deduping the retry', async () => {
    process.env.USD_ACCOUNTS_ENABLED = '1';
    process.env.USD_ACCOUNTS_ENABLE_STUB = '1';
    process.env.USD_ACCOUNTS_STUB_WEBHOOK_SECRET = 's';
    const raw = JSON.stringify({ id: 'e1', type: 'holder.verified', holderId: 'unknown' });

    const bad = await call('stub', raw, { [STUB_SIGNATURE_HEADER]: 'nope' });
    expect(bad.status).toBe(401);

    const good = await call('stub', raw, { [STUB_SIGNATURE_HEADER]: signStubWebhook(raw, 's') });
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ received: 1, duplicates: 0 });

    const retry = await call('stub', raw, { [STUB_SIGNATURE_HEADER]: signStubWebhook(raw, 's') });
    expect(await retry.json()).toMatchObject({ received: 0, duplicates: 1 });
  });
});
