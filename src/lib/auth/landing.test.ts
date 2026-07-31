import { describe, expect, it } from 'vitest';
import { decideLanding, STALE_LOGIN_DAYS } from './landing';

const NOW = new Date('2026-07-31T12:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('decideLanding', () => {
  it('sends a user with no payee source to wallet settings', () => {
    expect(
      decideLanding({
        hasPayeeSource: false,
        lastLoginAt: daysAgo(1),
        walletsReviewedAt: daysAgo(1),
        now: NOW,
      }),
    ).toMatchObject({ path: '/settings/wallets', reason: 'no_wallets' });
  });

  it('prioritises the missing wallet over everything, even on a fresh login', () => {
    expect(
      decideLanding({
        hasPayeeSource: false,
        lastLoginAt: NOW.toISOString(),
        walletsReviewedAt: NOW.toISOString(),
        now: NOW,
      }),
    ).toMatchObject({ reason: 'no_wallets' });
  });

  it('sends a returning user to wallet settings after a long gap', () => {
    expect(
      decideLanding({
        hasPayeeSource: true,
        lastLoginAt: daysAgo(STALE_LOGIN_DAYS + 5),
        walletsReviewedAt: null,
        now: NOW,
      }),
    ).toMatchObject({ path: '/settings/wallets', reason: 'stale_login' });
  });

  it('leaves an active user on the dashboard', () => {
    expect(
      decideLanding({
        hasPayeeSource: true,
        lastLoginAt: daysAgo(2),
        walletsReviewedAt: null,
        now: NOW,
      }),
    ).toMatchObject({ path: '/dashboard', reason: null });
  });

  it('does not re-prompt someone who already reviewed their wallets recently', () => {
    expect(
      decideLanding({
        hasPayeeSource: true,
        lastLoginAt: daysAgo(STALE_LOGIN_DAYS + 5),
        walletsReviewedAt: daysAgo(1),
        now: NOW,
      }),
    ).toMatchObject({ path: '/dashboard', reason: null });
  });

  it('prompts again once the review itself has gone stale', () => {
    expect(
      decideLanding({
        hasPayeeSource: true,
        lastLoginAt: daysAgo(STALE_LOGIN_DAYS + 5),
        walletsReviewedAt: daysAgo(STALE_LOGIN_DAYS + 1),
        now: NOW,
      }),
    ).toMatchObject({ reason: 'stale_login' });
  });

  it('treats a first-ever login as not stale', () => {
    // No previous login recorded — there is nothing to have gone stale, so only
    // the wallet check can redirect.
    expect(
      decideLanding({
        hasPayeeSource: true,
        lastLoginAt: null,
        walletsReviewedAt: null,
        now: NOW,
      }),
    ).toMatchObject({ path: '/dashboard', reason: null, daysSinceLastLogin: null });
  });

  it('reports the gap since the previous sign-in', () => {
    expect(
      decideLanding({
        hasPayeeSource: true,
        lastLoginAt: daysAgo(9),
        walletsReviewedAt: null,
        now: NOW,
      }),
    ).toMatchObject({ daysSinceLastLogin: 9 });
  });

  it('ignores an unparseable timestamp rather than redirecting on it', () => {
    expect(
      decideLanding({
        hasPayeeSource: true,
        lastLoginAt: 'not-a-date',
        walletsReviewedAt: null,
        now: NOW,
      }),
    ).toMatchObject({ path: '/dashboard', daysSinceLastLogin: null });
  });
});
