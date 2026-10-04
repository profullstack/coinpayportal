import { describe, expect, it, vi } from 'vitest';
import { businessHasPaypal } from './accounts';

function paypalAccountClient(result: { data: unknown; error: unknown }) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue(result);

  return { from: vi.fn(() => query) } as any;
}

describe('businessHasPaypal', () => {
  it('returns false after a successful lookup with no connected account', async () => {
    const supabase = paypalAccountClient({ data: null, error: null });

    await expect(businessHasPaypal(supabase, 'biz-1')).resolves.toBe(false);
  });

  it('surfaces lookup failures so callers can preserve the previous setting', async () => {
    const supabase = paypalAccountClient({
      data: null,
      error: { message: 'connection timed out' },
    });

    await expect(businessHasPaypal(supabase, 'biz-1')).rejects.toThrow(
      'Failed to resolve PayPal account: connection timed out'
    );
  });
});
