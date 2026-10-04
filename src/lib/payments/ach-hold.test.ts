import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_ACH_HOLD_HOURS,
  achHoldHours,
  railFromCharge,
  railIsHeld,
  holdUntilFor,
  settlementStatusFor,
  isHoldExpired,
  releaseExpiredAchHolds,
  achPayInEnabled,
} from './ach-hold';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.ACH_HOLD_HOURS;
});

afterEach(() => {
  process.env = originalEnv;
});

describe('achHoldHours', () => {
  it('defaults to 24 hours', () => {
    expect(achHoldHours()).toBe(DEFAULT_ACH_HOLD_HOURS);
    expect(DEFAULT_ACH_HOLD_HOURS).toBe(24);
  });

  it('takes a configured window', () => {
    process.env.ACH_HOLD_HOURS = '72';
    expect(achHoldHours()).toBe(72);
  });

  it('allows an explicit zero, which is a real choice', () => {
    process.env.ACH_HOLD_HOURS = '0';
    expect(achHoldHours()).toBe(0);
  });

  it('falls back to the default rather than turning the hold off', () => {
    // A misconfigured env var must fail towards a hold that is too long, never
    // towards one that is not there at all.
    for (const bad of ['', 'soon', '-5', 'NaN']) {
      process.env.ACH_HOLD_HOURS = bad;
      expect(achHoldHours()).toBe(DEFAULT_ACH_HOLD_HOURS);
    }
  });
});

describe('achPayInEnabled', () => {
  beforeEach(() => {
    process.env.STRIPE_ACH_ENABLED = '1';
  });

  it('offers ACH on a clean USD checkout once enabled', () => {
    expect(achPayInEnabled('usd', 'allow')).toBe(true);
    expect(achPayInEnabled('USD', 'allow')).toBe(true);
  });

  it('stays off until the rollout flag is set', () => {
    // Naming payment_method_types overrides the merchant's dashboard config, so
    // a connected account without ACH would fail the session outright.
    delete process.env.STRIPE_ACH_ENABLED;
    expect(achPayInEnabled('usd', 'allow')).toBe(false);

    process.env.STRIPE_ACH_ENABLED = 'true';
    expect(achPayInEnabled('usd', 'allow')).toBe(false);
  });

  it('is USD only', () => {
    for (const currency of ['eur', 'gbp', 'cad']) {
      expect(achPayInEnabled(currency, 'allow')).toBe(false);
    }
  });

  it('withholds ACH from a buyer the fraud layer flagged', () => {
    // `verify` forces 3DS, which moves card liability to the issuer. There is
    // no equivalent for a bank debit, so a flagged buyer must not be handed the
    // one rail where we carry the loss.
    expect(achPayInEnabled('usd', 'verify')).toBe(false);
    expect(achPayInEnabled('usd', 'block')).toBe(false);
  });
});

describe('railFromCharge', () => {
  it('reads the rail off the charge instead of assuming card', () => {
    expect(railFromCharge({ payment_method_details: { type: 'us_bank_account' } })).toBe('ach');
    expect(railFromCharge({ payment_method_details: { type: 'card' } })).toBe('card');
  });

  it('treats an unknown or missing method as card', () => {
    expect(railFromCharge({})).toBe('card');
    expect(railFromCharge(null)).toBe('card');
    expect(railFromCharge({ payment_method_details: { type: 'link' } })).toBe('card');
  });

  it('holds bank debits and not cards', () => {
    expect(railIsHeld('ach')).toBe(true);
    expect(railIsHeld('card')).toBe(false);
  });
});

describe('holdUntilFor', () => {
  const succeededAt = new Date('2026-09-06T12:00:00.000Z');

  it('holds an ACH payment for the configured window', () => {
    expect(holdUntilFor('ach', succeededAt, 24)).toBe('2026-09-07T12:00:00.000Z');
    expect(holdUntilFor('ach', succeededAt, 72)).toBe('2026-09-09T12:00:00.000Z');
  });

  it('does not hold a card payment', () => {
    // Null is the signal to complete now, not a missing value.
    expect(holdUntilFor('card', succeededAt, 24)).toBeNull();
  });

  it('picks the status that matches the rail', () => {
    expect(settlementStatusFor('ach')).toBe('held');
    expect(settlementStatusFor('card')).toBe('completed');
  });
});

describe('isHoldExpired', () => {
  const holdUntil = '2026-09-07T12:00:00.000Z';

  it('is not expired a minute early, and is expired on the second', () => {
    expect(isHoldExpired(holdUntil, new Date('2026-09-07T11:59:00.000Z'))).toBe(false);
    expect(isHoldExpired(holdUntil, new Date('2026-09-07T12:00:00.000Z'))).toBe(true);
    expect(isHoldExpired(holdUntil, new Date('2026-09-08T00:00:00.000Z'))).toBe(true);
  });

  it('treats a row with no hold as released', () => {
    // Every pre-ACH card row has this null; the alternative strands them.
    expect(isHoldExpired(null)).toBe(true);
    expect(isHoldExpired(undefined)).toBe(true);
  });

  it('keeps holding on a timestamp it cannot read', () => {
    // An unreadable value is not evidence the hold is over.
    expect(isHoldExpired('not a date', new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('releaseExpiredAchHolds', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');

  function clientReturning(result: { data: unknown; error: unknown }) {
    const select = vi.fn().mockResolvedValue(result);
    const lte = vi.fn().mockReturnValue({ select });
    const eq = vi.fn().mockReturnValue({ lte });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    return { client: { from }, from, update, eq, lte, select };
  }

  it('releases only held rows whose hold has come due', () => {
    const { client, from, update, eq, lte } = clientReturning({ data: [], error: null });

    return releaseExpiredAchHolds(client as never, now).then(() => {
      expect(from).toHaveBeenCalledWith('stripe_transactions');
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', updated_at: now.toISOString() })
      );
      // Filtering on status as well as time is what stops two overlapping cron
      // ticks releasing the same row and notifying the merchant twice.
      expect(eq).toHaveBeenCalledWith('status', 'held');
      expect(lte).toHaveBeenCalledWith('hold_until', now.toISOString());
    });
  });

  it('returns the released rows so the caller can notify', async () => {
    const row = {
      id: 'txn_1',
      business_id: 'biz_1',
      merchant_id: 'mer_1',
      amount: 5000,
      currency: 'usd',
      stripe_payment_intent_id: 'pi_1',
    };
    const { client } = clientReturning({ data: [row], error: null });

    expect(await releaseExpiredAchHolds(client as never, now)).toEqual([row]);
  });

  it('releases nothing when the update fails, rather than reporting a false release', async () => {
    const { client } = clientReturning({ data: null, error: { message: 'boom' } });

    expect(await releaseExpiredAchHolds(client as never, now)).toEqual([]);
  });

  it('copes with a successful update that returns no rows', async () => {
    const { client } = clientReturning({ data: null, error: null });

    expect(await releaseExpiredAchHolds(client as never, now)).toEqual([]);
  });
});
