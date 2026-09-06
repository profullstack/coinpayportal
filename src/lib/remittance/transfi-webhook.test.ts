import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  TRANSFI_SIGNATURE_HEADER,
  identifyTransfiEvent,
  transfiSignature,
  verifyTransfiSignature,
} from './transfi-webhook';

const SECRET = 'wk_test_exampleSecretValue';

describe('transfiSignature', () => {
  it('is a hex HMAC-SHA256 of the body keyed with the secret', () => {
    const body = '{"eventId":"evt_1","status":"completed"}';
    const expected = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');

    expect(transfiSignature(body, SECRET)).toBe(expected);
    expect(transfiSignature(body, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyTransfiSignature', () => {
  const body = '{"eventId":"evt_1","orderId":"ord_9","status":"completed"}';
  const good = transfiSignature(body, SECRET);

  it('accepts a signature over the exact raw body', () => {
    expect(verifyTransfiSignature(body, good, SECRET)).toBe(true);
  });

  it('accepts an upper-cased or padded header value', () => {
    expect(verifyTransfiSignature(body, `  ${good.toUpperCase()}  `, SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyTransfiSignature(body, transfiSignature(body, 'other'), SECRET)).toBe(false);
  });

  it('rejects a body altered after signing', () => {
    const tampered = body.replace('completed', 'failed');
    expect(verifyTransfiSignature(tampered, good, SECRET)).toBe(false);
  });

  it('rejects a missing signature or an unconfigured secret', () => {
    expect(verifyTransfiSignature(body, null, SECRET)).toBe(false);
    expect(verifyTransfiSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyTransfiSignature(body, '', SECRET)).toBe(false);
    expect(verifyTransfiSignature(body, good, '')).toBe(false);
  });

  it('rejects a short or malformed signature without throwing', () => {
    expect(verifyTransfiSignature(body, 'abc123', SECRET)).toBe(false);
    expect(verifyTransfiSignature(body, `${good}extra`, SECRET)).toBe(false);
  });

  /**
   * The trap this guards: TransFi's Python sample hashes json.dumps(body), so a
   * verifier that parses and re-serialises can disagree with the raw bytes over
   * nothing but spacing. Re-serialising must NOT be treated as equivalent.
   */
  it('is sensitive to re-serialisation of the same object', () => {
    const spaced = JSON.stringify(JSON.parse(body), null, 2);
    expect(spaced).not.toBe(body);
    expect(verifyTransfiSignature(spaced, good, SECRET)).toBe(false);
  });

  it('exposes the header name lower-cased, as runtimes deliver it', () => {
    expect(TRANSFI_SIGNATURE_HEADER).toBe('x-transfi-hmac-hash');
    expect(TRANSFI_SIGNATURE_HEADER).toBe(TRANSFI_SIGNATURE_HEADER.toLowerCase());
  });
});

describe('identifyTransfiEvent', () => {
  it('reads a flat camelCase envelope', () => {
    expect(
      identifyTransfiEvent({
        eventId: 'evt_1',
        eventType: 'payout.completed',
        orderId: 'ord_9',
        status: 'completed',
      })
    ).toEqual({
      eventId: 'evt_1',
      eventType: 'payout.completed',
      orderId: 'ord_9',
      status: 'completed',
    });
  });

  it('reads a snake_case envelope and a nested data object', () => {
    expect(
      identifyTransfiEvent({
        event_id: 'evt_2',
        event_type: 'payout.failed',
        data: { order_id: 'ord_10', status: 'failed' },
      })
    ).toEqual({
      eventId: 'evt_2',
      eventType: 'payout.failed',
      orderId: 'ord_10',
      status: 'failed',
    });
  });

  it('falls back to a payout id when no order id is present', () => {
    expect(identifyTransfiEvent({ id: 'evt_3', type: 'x', data: { payoutId: 'pay_1' } }).orderId)
      .toBe('pay_1');
  });

  it('returns an empty event id rather than inventing one', () => {
    expect(identifyTransfiEvent({ status: 'completed' }).eventId).toBe('');
    expect(identifyTransfiEvent(null).eventId).toBe('');
    expect(identifyTransfiEvent(undefined).eventId).toBe('');
  });

  it('ignores blank strings when choosing an id', () => {
    expect(identifyTransfiEvent({ eventId: '   ', id: 'evt_4' }).eventId).toBe('evt_4');
  });
});
