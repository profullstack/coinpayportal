import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}));

import { sendEmail } from '@/lib/email';
import { notifyCountered, notifyDecided } from './notify';

const CLIENT_EMAIL = 'client@example.com';
const MERCHANT_EMAIL = 'merchant@example.com';

const proposal = {
  id: 'prop-1',
  user_id: 'merchant-1',
  business_id: 'biz-1',
  client_id: 'client-1',
  proposal_number: 'PROP-001',
  title: 'Website redesign',
  access_token: 'tok_abcdefghijklmnopqrstuvwxyz012345',
} as never;

const revision = {
  amount: '2500.00',
  currency: 'USD',
  message: 'Scope grew',
} as never;

/** Answers the three lookups loadParties makes. */
function fakeSupabase(overrides: { clientEmail?: string | null; merchantEmail?: string | null } = {}) {
  const clientEmail = overrides.clientEmail === undefined ? CLIENT_EMAIL : overrides.clientEmail;
  const merchantEmail = overrides.merchantEmail === undefined ? MERCHANT_EMAIL : overrides.merchantEmail;

  return {
    from(table: string) {
      const row =
        table === 'clients'
          ? clientEmail
            ? { name: 'Alice', email: clientEmail, company_name: 'Acme' }
            : null
          : table === 'businesses'
            ? { name: 'My Business' }
            : merchantEmail
              ? { email: merchantEmail }
              : null;

      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row }) }),
        }),
      };
    },
  } as never;
}

describe('notifyCountered', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emails the client when the merchant counters', async () => {
    await notifyCountered(fakeSupabase(), { proposal, revision, by: 'merchant' });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe(CLIENT_EMAIL);
    // The client responds through the token link, never the merchant dashboard.
    expect(call.html).toContain('/proposals/respond/');
  });

  it('emails the merchant when the client counters', async () => {
    await notifyCountered(fakeSupabase(), { proposal, revision, by: 'client' });

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe(MERCHANT_EMAIL);
    // ...and the merchant gets the internal link, not the public token.
    expect(call.html).not.toContain('/proposals/respond/');
    expect(call.html).toContain('/proposals/prop-1');
  });

  it('stays silent when the recipient has no email on file', async () => {
    await notifyCountered(fakeSupabase({ clientEmail: null }), {
      proposal,
      revision,
      by: 'merchant',
    });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never lets a delivery failure escape', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('smtp down'));

    // The state change already committed — this must not throw.
    await expect(
      notifyCountered(fakeSupabase(), { proposal, revision, by: 'merchant' }),
    ).resolves.toBeUndefined();
  });
});

describe('notifyDecided', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tells the client when the merchant accepts', async () => {
    await notifyDecided(fakeSupabase(), {
      proposal,
      revision,
      by: 'merchant',
      decision: 'accepted',
    });

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe(CLIENT_EMAIL);
    expect(call.subject).toMatch(/accepted/i);
  });

  it('tells the merchant when the client declines', async () => {
    await notifyDecided(fakeSupabase(), {
      proposal,
      revision,
      by: 'client',
      decision: 'rejected',
    });

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe(MERCHANT_EMAIL);
    expect(call.subject).toMatch(/declined/i);
  });

  it('survives a missing revision', async () => {
    await notifyDecided(fakeSupabase(), {
      proposal,
      revision: null,
      by: 'client',
      decision: 'rejected',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
