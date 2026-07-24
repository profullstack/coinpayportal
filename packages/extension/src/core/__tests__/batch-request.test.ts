/**
 * `parseBatchRequests` guards the boundary between an untrusted web page and a
 * wallet that spends real money. Every input here is attacker-controlled, so
 * these tests are mostly about what must be REJECTED.
 */

import { describe, it, expect } from 'vitest';

import { parseBatchRequests } from '../batch.js';

const MAX = 500;

function payment(overrides: Record<string, unknown> = {}) {
  return { id: 'inv-1', chain: 'usdc_pol', to: '0xabc', amount: '10', ...overrides };
}

describe('parseBatchRequests', () => {
  it('normalizes a well-formed batch', () => {
    const result = parseBatchRequests(
      [payment({ label: 'Ada — Fix login', amountUsd: 10 })],
      MAX,
    );

    expect(result).toEqual([
      {
        id: 'inv-1',
        chain: 'USDC_POL', // wire code normalized to a chain the wallet signs
        to: '0xabc',
        amount: '10',
        label: 'Ada — Fix login',
        amountUsd: 10,
      },
    ]);
  });

  it('trims whitespace around addresses and amounts', () => {
    const [result] = parseBatchRequests([payment({ to: '  0xabc  ', amount: ' 10 ' })], MAX);
    expect(result).toMatchObject({ to: '0xabc', amount: '10' });
  });

  it('rejects duplicate ids', () => {
    // The single most dangerous input: it would make results ambiguous and is
    // exactly how a worker ends up paid twice.
    expect(() => parseBatchRequests([payment(), payment()], MAX)).toThrow(/Duplicate payment id/);
  });

  it('rejects an empty or non-array batch', () => {
    expect(() => parseBatchRequests([], MAX)).toThrow(/No payments supplied/);
    expect(() => parseBatchRequests(null, MAX)).toThrow(/No payments supplied/);
    expect(() => parseBatchRequests('62 payments', MAX)).toThrow(/No payments supplied/);
    expect(() => parseBatchRequests({ length: 2 }, MAX)).toThrow(/No payments supplied/);
  });

  it('enforces the batch size cap', () => {
    const many = Array.from({ length: 4 }, (_, i) => payment({ id: `inv-${i}` }));
    expect(() => parseBatchRequests(many, 3)).toThrow(/Too many payments/);
    expect(parseBatchRequests(many, 4)).toHaveLength(4);
  });

  it('rejects a missing or non-string id, naming the position', () => {
    expect(() => parseBatchRequests([payment({ id: undefined })], MAX)).toThrow(
      /Payment #1 is missing an id/,
    );
    expect(() => parseBatchRequests([payment({ id: 123 })], MAX)).toThrow(/missing an id/);
    expect(() => parseBatchRequests([payment({ id: '' })], MAX)).toThrow(/missing an id/);
  });

  it('rejects a missing recipient', () => {
    expect(() => parseBatchRequests([payment({ to: '   ' })], MAX)).toThrow(
      /missing a recipient address/,
    );
    expect(() => parseBatchRequests([payment({ to: undefined })], MAX)).toThrow(
      /missing a recipient address/,
    );
  });

  it('rejects a chain the wallet cannot sign instead of guessing', () => {
    // Guessing would broadcast real funds on the wrong network.
    expect(() => parseBatchRequests([payment({ chain: 'DOGE' })], MAX)).toThrow(
      /unsupported chain/,
    );
    expect(() => parseBatchRequests([payment({ chain: undefined })], MAX)).toThrow(
      /unsupported chain/,
    );
  });

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['not a number', 'abc'],
    ['empty', ''],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['null', null],
  ])('rejects a %s amount', (_label, amount) => {
    expect(() => parseBatchRequests([payment({ amount })], MAX)).toThrow(/invalid amount/);
  });

  it('accepts a numeric amount and stringifies it', () => {
    const [result] = parseBatchRequests([payment({ amount: 0.5 })], MAX);
    expect(result).toMatchObject({ amount: '0.5' });
  });

  it('caps an overlong label so it cannot flood the approval screen', () => {
    // A page could otherwise push the Approve button off-screen behind text.
    const [result] = parseBatchRequests([payment({ label: 'x'.repeat(5000) })], MAX);
    expect(result!.label).toHaveLength(200);
  });

  it('drops non-string labels and non-numeric USD rather than rendering them', () => {
    const [result] = parseBatchRequests(
      [payment({ label: { toString: () => 'evil' }, amountUsd: '10' })],
      MAX,
    );
    expect(result!.label).toBeUndefined();
    expect(result!.amountUsd).toBeUndefined();
  });

  it('survives null and non-object entries without crashing the worker', () => {
    expect(() => parseBatchRequests([null], MAX)).toThrow(/missing an id/);
    expect(() => parseBatchRequests(['nope'], MAX)).toThrow(/missing an id/);
  });

  it('reports the first problem and does not partially accept a batch', () => {
    expect(() =>
      parseBatchRequests([payment({ id: 'a' }), payment({ id: 'b', chain: 'DOGE' })], MAX),
    ).toThrow(/Payment b has an unsupported chain/);
  });
});
