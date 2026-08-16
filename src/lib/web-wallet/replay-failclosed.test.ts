import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Replay prevention must FAIL CLOSED.
 *
 * The shared (Supabase) store is what makes replay protection global. When it
 * errored, the old code returned null and fell through to a per-process
 * in-memory Map — so on a multi-instance deployment a signature spent on
 * instance A was unknown to instance B, and protection quietly evaporated at
 * exactly the moment the store was unhealthy.
 */

const insertMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: insertMock })),
  })),
}));

describe('replay prevention fails closed', () => {
  beforeEach(() => {
    vi.resetModules();
    insertMock.mockReset();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects when the shared store is configured but unreachable', async () => {
    insertMock.mockRejectedValue(new Error('connection refused'));

    const { checkAndRecordSignatureAsync } = await import('./rate-limit');
    const fresh = await checkAndRecordSignatureAsync(`sig-unreachable-${Date.now()}`);

    // Not "fresh". An unanswerable store means refuse, not assume.
    expect(fresh).toBe(false);
  });

  it('accepts a genuinely fresh signature when the store answers', async () => {
    insertMock.mockResolvedValue({ error: null });

    const { checkAndRecordSignatureAsync } = await import('./rate-limit');
    expect(await checkAndRecordSignatureAsync(`sig-fresh-${Date.now()}`)).toBe(true);
  });

  it('rejects a replay the store recognises', async () => {
    // 23505 = unique_violation: this exact signature was already recorded.
    insertMock.mockResolvedValue({ error: { code: '23505' } });

    const { checkAndRecordSignatureAsync } = await import('./rate-limit');
    expect(await checkAndRecordSignatureAsync(`sig-replay-${Date.now()}`)).toBe(false);
  });

  it('still works in-memory when no shared store is configured at all', async () => {
    // Local development: per-process is all there is, so it is used rather than
    // refusing every request.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    const { checkAndRecordSignatureAsync } = await import('./rate-limit');
    const key = `sig-local-${Date.now()}`;

    expect(await checkAndRecordSignatureAsync(key)).toBe(true);
    expect(await checkAndRecordSignatureAsync(key)).toBe(false);
  });
});
