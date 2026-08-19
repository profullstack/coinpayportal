import { describe, it, expect } from 'vitest';
import {
  inferAccountKind,
  effectiveKind,
  isLiabilityKind,
  isAccountKind,
  categorizeTransaction,
  categoryLabel,
} from './classify';

/**
 * The account names below are the real ones the live connection returns. They
 * are the point of this file: "DCU Cash Rewards" and "Coastal Cash Visa
 * Signature" are credit cards whose names contain deposit-account words, and a
 * naive keyword pass puts both on the wrong side of the balance sheet.
 */
describe('inferAccountKind', () => {
  it('classifies deposit accounts from their names', () => {
    expect(inferAccountKind('Free Checking (0000)', 'Digital Federal Credit Union')).toBe('checking');
    expect(inferAccountKind('BASIC CHECKING (0000)', 'Technology Credit Union')).toBe('checking');
    expect(inferAccountKind('Primary Savings (0000)', 'Digital Federal Credit Union')).toBe('savings');
    expect(inferAccountKind('Money Market (0000)', 'Digital Federal Credit Union')).toBe('savings');
    expect(inferAccountKind('J D Checking (XXXX0000)', 'Bay Federal Credit Union')).toBe('checking');
  });

  it('classifies cards by network and product name', () => {
    expect(inferAccountKind('VISA SIGNATURE (0000)', 'Technology Credit Union')).toBe('credit');
    expect(inferAccountKind('Sapphire Preferred (0000)', 'Chase Bank')).toBe('credit');
    expect(inferAccountKind('Discover it (0000)', 'Capital One')).toBe('credit');
    expect(
      inferAccountKind('Anywhere Visa® Card by Example-0000 (0000)', 'Citibank'),
    ).toBe('credit');
    expect(
      inferAccountKind('Graphite™ Business Cash Unlimited Card (0000)', 'American Express'),
    ).toBe('credit');
  });

  it('does not let a card name containing "cash" read as a deposit account', () => {
    // The trap: both names contain "Cash", and one also contains "Signature".
    expect(inferAccountKind('Cash Rewards (0000)', 'Digital Federal Credit Union')).toBe('credit');
    expect(
      inferAccountKind('Coastal Cash Visa Signature (XXXX0000)', 'Bay Federal Credit Union'),
    ).toBe('credit');
  });

  it('falls back to the institution when the account is named after its holder', () => {
    // Apple Card arrives as org "Apple Card (Updated Monthly)" with the
    // account simply named after the cardholder.
    expect(inferAccountKind('J. Doe', 'Apple Card (Updated Monthly)')).toBe('credit');
  });

  it('uses a negative balance only to break a tie', () => {
    expect(inferAccountKind('Unlabelled account', null, -500)).toBe('credit');
    // An overdrawn checking account must stay checking.
    expect(inferAccountKind('Free Checking (0000)', 'DCU', -42)).toBe('checking');
  });

  it('returns unknown rather than guessing', () => {
    expect(inferAccountKind('', null, null)).toBe('unknown');
    expect(inferAccountKind('Account 12345', null, 100)).toBe('unknown');
  });

  it('recognises loans and investments', () => {
    expect(inferAccountKind('Auto Loan 4432', 'DCU')).toBe('loan');
    expect(inferAccountKind('Roth IRA', 'Fidelity')).toBe('investment');
    expect(inferAccountKind('Brokerage', 'Schwab')).toBe('investment');
  });
});

describe('effectiveKind', () => {
  it('prefers the operator override over the derived kind', () => {
    expect(effectiveKind({ kind: 'credit', kind_override: 'loan' })).toBe('loan');
  });

  it('falls back to the derived kind when there is no override', () => {
    expect(effectiveKind({ kind: 'savings', kind_override: null })).toBe('savings');
  });

  it('ignores an override that is not a known kind', () => {
    expect(effectiveKind({ kind: 'checking', kind_override: 'nonsense' })).toBe('checking');
  });

  it('degrades to unknown rather than throwing on junk', () => {
    expect(effectiveKind({ kind: null, kind_override: null })).toBe('unknown');
  });
});

describe('isLiabilityKind / isAccountKind', () => {
  it('treats only credit and loan as debt', () => {
    expect(isLiabilityKind('credit')).toBe(true);
    expect(isLiabilityKind('loan')).toBe(true);
    expect(isLiabilityKind('checking')).toBe(false);
    expect(isLiabilityKind('unknown')).toBe(false);
  });

  it('validates kind strings', () => {
    expect(isAccountKind('savings')).toBe(true);
    expect(isAccountKind('crypto')).toBe(false);
    expect(isAccountKind(null)).toBe(false);
  });
});

describe('categorizeTransaction', () => {
  it('prefers the MCC over the description text', () => {
    // MCC 5411 is a grocery store, whatever the description says.
    expect(
      categorizeTransaction({ mcc: '5411', description: 'AMAZON MKTPL', amount: -30 }),
    ).toBe('groceries');
    expect(categorizeTransaction({ mcc: 5812, description: 'unknown', amount: -22 })).toBe('dining');
    expect(categorizeTransaction({ mcc: '5541', description: '', amount: -60 })).toBe('fuel');
  });

  it('ignores an MCC that is not a real code', () => {
    expect(categorizeTransaction({ mcc: 'abc', payee: 'Starbucks', amount: -6 })).toBe('dining');
    expect(categorizeTransaction({ mcc: '', payee: 'Starbucks', amount: -6 })).toBe('dining');
  });

  it('matches card payments and transfers before anything else', () => {
    expect(
      categorizeTransaction({ description: 'PAYMENT THANK YOU - WEB', amount: 500 }),
    ).toBe('payment');
    expect(categorizeTransaction({ description: 'AUTOPAY 0000 - THANK YOU', amount: 300 })).toBe(
      'payment',
    );
    // Zelle to a person is a transfer, not a card payment — "payment" here is
    // reserved for settling a card balance, which must not be counted as spend.
    expect(categorizeTransaction({ description: 'Zelle payment to J Smith', amount: -100 })).toBe(
      'transfer',
    );
    expect(categorizeTransaction({ description: 'TRANSFER TO SHARE 0001', amount: -50 })).toBe(
      'transfer',
    );
  });

  it('recognises income only on a credit', () => {
    expect(categorizeTransaction({ description: 'DIRECT DEP PAYROLL', amount: 4200 })).toBe('income');
    // A debit that mentions payroll is not income; better to fall through than
    // to record negative income.
    expect(categorizeTransaction({ description: 'PAYROLL FEE', amount: -12 })).toBe('fees');
  });

  it('categorises software and infrastructure spend', () => {
    expect(categorizeTransaction({ payee: 'AWS', amount: -220 })).toBe('software');
    expect(categorizeTransaction({ payee: 'ANTHROPIC', amount: -20 })).toBe('software');
    expect(categorizeTransaction({ payee: 'Railway', amount: -25 })).toBe('software');
  });

  it('returns null when nothing matches, rather than inventing "other"', () => {
    expect(categorizeTransaction({ description: 'XYZ 4471 REF 99', amount: -18 })).toBeNull();
    expect(categorizeTransaction({ amount: -18 })).toBeNull();
    expect(categorizeTransaction({ description: '   ', amount: -18 })).toBeNull();
  });
});

describe('categoryLabel', () => {
  it('names the null bucket explicitly', () => {
    expect(categoryLabel(null)).toBe('Uncategorised');
    expect(categoryLabel(undefined)).toBe('Uncategorised');
    expect(categoryLabel('groceries')).toBe('Groceries');
  });
});
