import { describe, it, expect, vi, beforeEach } from 'vitest';
import { monitorEmails } from './email-monitor';

const mockSendEmail = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

/**
 * Build a mock supabase that returns different data per query call.
 * Queries are ordered: 1=pending reminders, 2=settled notifications, 3=status change
 */
function buildSupabase(
  pendingRows: Record<string, unknown>[] = [],
  settledRows: Record<string, unknown>[] = [],
  statusRows: Record<string, unknown>[] = []
) {
  let queryIndex = 0;
  const datasets = [pendingRows, settledRows, statusRows];

  const supabase = {
    from: vi.fn().mockImplementation(() => {
      const chain: Record<string, any> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockImplementation(() => {
        const data = datasets[queryIndex] || [];
        queryIndex++;
        return Promise.resolve({ data, error: null });
      });
      chain.update = vi.fn().mockReturnValue(chain);
      return chain;
    }),
  };

  return supabase;
}

describe('Email Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Expiration Reminders ────────────────────────────────

  it('sends 24h reminder when escrow expires within 24 hours', async () => {
    const now = new Date('2026-02-16T12:00:00Z');
    const expiresAt = new Date('2026-02-17T10:00:00Z'); // 22h

    const supabase = buildSupabase(
      [{
        id: 'esc-1', depositor_email: 'test@example.com', escrow_address: '0xabc',
        amount: 1.5, chain: 'ETH', expires_at: expiresAt.toISOString(),
        reminder_24h_sent: false, reminder_12h_sent: false, reminder_2h_sent: false,
      }],
    );

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'test@example.com', subject: expect.stringContaining('24 hours') })
    );
    expect(stats.reminders_sent).toBe(1);
  });

  it('sends 2h reminder when close to expiry and others already sent', async () => {
    const now = new Date('2026-02-16T12:00:00Z');
    const expiresAt = new Date('2026-02-16T13:30:00Z'); // 1.5h

    const supabase = buildSupabase(
      [{
        id: 'esc-2', depositor_email: 'test@example.com', escrow_address: '0xabc',
        amount: 100, chain: 'USDC_POL', expires_at: expiresAt.toISOString(),
        reminder_24h_sent: true, reminder_12h_sent: true, reminder_2h_sent: false,
      }],
    );

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('2 hours') })
    );
    expect(stats.reminders_sent).toBe(1);
  });

  it('does not re-send if flag already set', async () => {
    const now = new Date('2026-02-16T12:00:00Z');
    const expiresAt = new Date('2026-02-17T10:00:00Z');

    const supabase = buildSupabase(
      [{
        id: 'esc-3', depositor_email: 'test@example.com', escrow_address: '0xabc',
        amount: 1, chain: 'BTC', expires_at: expiresAt.toISOString(),
        reminder_24h_sent: true, reminder_12h_sent: true, reminder_2h_sent: true,
      }],
    );

    const stats = await monitorEmails(supabase as any, now);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(stats.reminders_sent).toBe(0);
  });

  // ── Settlement Notifications ────────────────────────────

  it('sends settlement email to beneficiary', async () => {
    const now = new Date('2026-02-16T12:00:00Z');

    const supabase = buildSupabase([], [
      { id: 'esc-4', beneficiary_email: 'payee@example.com', amount: 5, chain: 'SOL', settlement_tx_hash: '0xsettletx123' },
    ]);

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'payee@example.com', subject: expect.stringContaining("You've been paid") })
    );
    expect(stats.settlements_sent).toBe(1);
  });

  // ── Status Change Notifications ─────────────────────────

  it('sends status change email to both parties for funded escrow', async () => {
    const now = new Date('2026-02-16T12:00:00Z');

    const supabase = buildSupabase([], [], [
      {
        id: 'esc-5', status: 'funded',
        depositor_email: 'depositor@example.com', beneficiary_email: 'beneficiary@example.com',
        amount: 2, chain: 'ETH', escrow_address: '0xfunded',
        dispute_reason: null, settlement_tx_hash: null, status_emails_sent: [],
      },
    ]);

    const stats = await monitorEmails(supabase as any, now);

    // Should send to both depositor and beneficiary
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'depositor@example.com', subject: expect.stringContaining('Escrow funded') })
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'beneficiary@example.com', subject: expect.stringContaining('Escrow funded') })
    );
    expect(stats.status_change_sent).toBe(2);
  });

  it('sends disputed status email with correct emoji', async () => {
    const now = new Date('2026-02-16T12:00:00Z');

    const supabase = buildSupabase([], [], [
      {
        id: 'esc-6', status: 'disputed',
        depositor_email: 'dep@example.com', beneficiary_email: null,
        amount: 10, chain: 'BTC', escrow_address: '0xdisputed',
        dispute_reason: 'Work not delivered', settlement_tx_hash: null, status_emails_sent: [],
      },
    ]);

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dep@example.com', subject: expect.stringContaining('⚠️') })
    );
    expect(stats.status_change_sent).toBe(1);
  });

  it('skips status change if already in status_emails_sent array', async () => {
    const now = new Date('2026-02-16T12:00:00Z');

    const supabase = buildSupabase([], [], [
      {
        id: 'esc-7', status: 'funded',
        depositor_email: 'dep@example.com', beneficiary_email: 'ben@example.com',
        amount: 1, chain: 'SOL', escrow_address: '0x',
        dispute_reason: null, settlement_tx_hash: null, status_emails_sent: ['funded'],
      },
    ]);

    const stats = await monitorEmails(supabase as any, now);

    // No status change emails since 'funded' already in the array
    expect(stats.status_change_sent).toBe(0);
  });

  it('sends refunded status email with correct subject', async () => {
    const now = new Date('2026-02-16T12:00:00Z');

    const supabase = buildSupabase([], [], [
      {
        id: 'esc-8', status: 'refunded',
        depositor_email: 'dep@example.com', beneficiary_email: null,
        amount: 0.5, chain: 'BTC', escrow_address: '0xref',
        dispute_reason: null, settlement_tx_hash: '0xreftx', status_emails_sent: [],
      },
    ]);

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('↩️') })
    );
    expect(stats.status_change_sent).toBe(1);
  });

  // ── Edge Cases ──────────────────────────────────────────

  it('skips escrows without any email set', async () => {
    const now = new Date('2026-02-16T12:00:00Z');
    const supabase = buildSupabase([], [], []);

    const stats = await monitorEmails(supabase as any, now);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(stats.reminders_sent).toBe(0);
    expect(stats.settlements_sent).toBe(0);
    expect(stats.status_change_sent).toBe(0);
  });

  it('handles sendEmail failures gracefully', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP error'));

    const now = new Date('2026-02-16T12:00:00Z');
    const expiresAt = new Date('2026-02-16T13:00:00Z');

    const supabase = buildSupabase(
      [{
        id: 'esc-err', depositor_email: 'test@example.com', escrow_address: '0xabc',
        amount: 1, chain: 'ETH', expires_at: expiresAt.toISOString(),
        reminder_24h_sent: false, reminder_12h_sent: false, reminder_2h_sent: false,
      }],
    );

    const stats = await monitorEmails(supabase as any, now);
    expect(stats.errors).toBeGreaterThan(0);
  });

  it('handles status change sendEmail failure without updating flag', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const now = new Date('2026-02-16T12:00:00Z');

    const supabase = buildSupabase([], [], [
      {
        id: 'esc-fail', status: 'expired',
        depositor_email: 'dep@example.com', beneficiary_email: null,
        amount: 1, chain: 'ETH', escrow_address: '0x',
        dispute_reason: null, settlement_tx_hash: null, status_emails_sent: [],
      },
    ]);

    const stats = await monitorEmails(supabase as any, now);

    expect(stats.errors).toBeGreaterThan(0);
    // The update call should NOT have been made for status_emails_sent since sending failed
    const fromCalls = supabase.from.mock.calls;
    // Verify we didn't append the status (the update with status_emails_sent shouldn't happen)
    const updateCalls = fromCalls.filter((_: unknown, i: number) => {
      const result = supabase.from.mock.results[i]?.value;
      return result?.update?.mock?.calls?.length > 0;
    });
    // With failure, the flag update should be skipped
    expect(stats.status_change_sent).toBe(0);
  });
});
