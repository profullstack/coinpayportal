import { describe, expect, it } from 'vitest';
import {
  COUNTERABLE_BY,
  canAccept,
  isNegotiable,
  type ProposalRevision,
  type ProposalStatus,
} from './types';

function revision(
  proposedBy: 'merchant' | 'client',
  status: ProposalRevision['status'] = 'open',
): Pick<ProposalRevision, 'proposed_by' | 'status'> {
  return { proposed_by: proposedBy, status };
}

const TERMINAL: ProposalStatus[] = ['accepted', 'rejected', 'withdrawn', 'expired'];

describe('isNegotiable', () => {
  it('is true only while the proposal is live', () => {
    expect(isNegotiable('sent')).toBe(true);
    expect(isNegotiable('countered')).toBe(true);
    expect(isNegotiable('draft')).toBe(false);
    for (const status of TERMINAL) {
      expect(isNegotiable(status)).toBe(false);
    }
  });
});

describe('canAccept', () => {
  it('lets the client accept what the merchant sent', () => {
    expect(canAccept('sent', revision('merchant'), 'client')).toBe(true);
  });

  it('lets the merchant accept a client counter-offer', () => {
    expect(canAccept('countered', revision('client'), 'merchant')).toBe(true);
  });

  it('never lets a party accept its own offer', () => {
    expect(canAccept('sent', revision('merchant'), 'merchant')).toBe(false);
    expect(canAccept('countered', revision('client'), 'client')).toBe(false);
  });

  it('refuses once the negotiation has ended', () => {
    for (const status of TERMINAL) {
      expect(canAccept(status, revision('merchant'), 'client')).toBe(false);
    }
  });

  it('refuses on a draft the client has never seen', () => {
    expect(canAccept('draft', revision('merchant'), 'client')).toBe(false);
  });

  it('refuses when the standing revision is no longer open', () => {
    expect(canAccept('sent', revision('merchant', 'superseded'), 'client')).toBe(false);
    expect(canAccept('sent', revision('merchant', 'rejected'), 'client')).toBe(false);
  });

  it('refuses when there is no revision at all', () => {
    expect(canAccept('sent', null, 'client')).toBe(false);
  });
});

describe('COUNTERABLE_BY', () => {
  it('lets both sides counter while the negotiation is live', () => {
    expect(COUNTERABLE_BY.sent).toEqual(expect.arrayContaining(['merchant', 'client']));
    expect(COUNTERABLE_BY.countered).toEqual(expect.arrayContaining(['merchant', 'client']));
  });

  it('keeps the client out of a draft', () => {
    expect(COUNTERABLE_BY.draft).toEqual(['merchant']);
  });

  it('closes every terminal state to both sides', () => {
    for (const status of TERMINAL) {
      expect(COUNTERABLE_BY[status]).toEqual([]);
    }
  });
});
