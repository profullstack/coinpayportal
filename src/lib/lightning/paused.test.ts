import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isLightningPath, lightningPaused } from './paused';
import { proxy } from '../../proxy';

afterEach(() => { delete process.env.LIGHTNING_PAUSED; });

describe('LIGHTNING_PAUSED', () => {
  it('is off unless set', () => {
    expect(lightningPaused()).toBe(false);
    process.env.LIGHTNING_PAUSED = '1';
    expect(lightningPaused()).toBe(true);
  });

  it('covers the Lightning API and both lnurlp routes, nothing else', () => {
    for (const p of ['/api/lightning/invoices', '/api/lightning', '/.well-known/lnurlp/alice', '/lnurlp/alice/callback']) expect(isLightningPath(p), p).toBe(true);
    for (const p of ['/api/payments', '/lightningish', '/docs', '/']) expect(isLightningPath(p), p).toBe(false);
  });

  it('answers 503 with a LUD-06 error while paused', async () => {
    process.env.LIGHTNING_PAUSED = '1';
    const res = await proxy(new NextRequest('https://coinpayportal.com/.well-known/lnurlp/alice'));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('ERROR');
  });
});
