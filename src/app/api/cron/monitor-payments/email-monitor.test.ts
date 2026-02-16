import { describe, it, expect, vi, beforeEach } from 'vitest';
import { monitorEmails } from './email-monitor';

const mockSendEmail = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

function buildSupabase(pendingRows: Record<string, unknown>[], settledRows: Record<string, unknown>[]) {
  let queryIndex = 0;

  const supabase = {
    from: vi.fn().mockImplementation(() => {
      let isUpdate = false;
      let updateData: Record<string, unknown> = {};

      const chain: Record<string, jest.Mock> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockImplementation(() => {
        const data = queryIndex === 0 ? pendingRows : settledRows;
        queryIndex++;
        return Promise.resolve({ data, error: null });
      });
      chain.update = vi.fn().mockImplementation((data: Record<string, unknown>) => {
        isUpdate = true;
        updateData = data;
        return chain;
      });

      return chain;
    }),
  };

  return supabase;
}

describe('Email Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends 24h reminder when escrow expires within 24 hours', async () => {
    const now = new Date('2026-02-16T12:00:00Z');
    const expiresAt = new Date('2026-02-17T10:00:00Z'); // 22h from now

    const supabase = buildSupabase(
      [{
        id: 'esc-1',
        depositor_email: 'test@example.com',
        escrow_address: '0xabc',
        amount: 1.5,
        chain: 'ETH',
        expires_at: expiresAt.toISOString(),
        reminder_24h_sent: false,
        reminder_12h_sent: false,
        reminder_2h_sent: false,
      }],
      []
    );

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        subject: expect.stringContaining('24 hours'),
      })
    );
    expect(stats.reminders_sent).toBe(1);
  });

  it('sends 2h reminder when close to expiry and others already sent', async () => {
    const now = new Date('2026-02-16T12:00:00Z');
    const expiresAt = new Date('2026-02-16T13:30:00Z'); // 1.5h from now

    const supabase = buildSupabase(
      [{
        id: 'esc-2',
        depositor_email: 'test@example.com',
        escrow_address: '0xabc',
        amount: 100,
        chain: 'USDC_POL',
        expires_at: expiresAt.toISOString(),
        reminder_24h_sent: true,
        reminder_12h_sent: true,
        reminder_2h_sent: false,
      }],
      []
    );

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('2 hours'),
      })
    );
    expect(stats.reminders_sent).toBe(1);
  });

  it('does not re-send if flag already set', async () => {
    const now = new Date('2026-02-16T12:00:00Z');
    const expiresAt = new Date('2026-02-17T10:00:00Z');

    const supabase = buildSupabase(
      [{
        id: 'esc-3',
        depositor_email: 'test@example.com',
        escrow_address: '0xabc',
        amount: 1,
        chain: 'BTC',
        expires_at: expiresAt.toISOString(),
        reminder_24h_sent: true,
        reminder_12h_sent: true,
        reminder_2h_sent: true,
      }],
      []
    );

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(stats.reminders_sent).toBe(0);
  });

  it('sends settlement email to beneficiary', async () => {
    const now = new Date('2026-02-16T12:00:00Z');

    const supabase = buildSupabase(
      [],
      [{
        id: 'esc-4',
        beneficiary_email: 'payee@example.com',
        amount: 5,
        chain: 'SOL',
        settlement_tx_hash: '0xsettletx123',
      }]
    );

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'payee@example.com',
        subject: expect.stringContaining("You've been paid"),
      })
    );
    expect(stats.settlements_sent).toBe(1);
  });

  it('skips escrows without email (empty query results)', async () => {
    const now = new Date('2026-02-16T12:00:00Z');
    const supabase = buildSupabase([], []);

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(stats.reminders_sent).toBe(0);
    expect(stats.settlements_sent).toBe(0);
  });

  it('handles sendEmail failures gracefully', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP error'));

    const now = new Date('2026-02-16T12:00:00Z');
    const expiresAt = new Date('2026-02-16T13:00:00Z');

    const supabase = buildSupabase(
      [{
        id: 'esc-5',
        depositor_email: 'test@example.com',
        escrow_address: '0xabc',
        amount: 1,
        chain: 'ETH',
        expires_at: expiresAt.toISOString(),
        reminder_24h_sent: false,
        reminder_12h_sent: false,
        reminder_2h_sent: false,
      }],
      []
    );

    const stats = await monitorEmails(supabase as any, now);

    expect(stats.errors).toBeGreaterThan(0);
  });
});
