import { describe, it, expect } from 'vitest';
import {
  entryChainId,
  entryAmount,
  selectPayableEntry,
  buildAuthorization,
  signX402Payment,
  summarizeX402,
  formatAmount,
  randomNonce,
  encodePaymentHeader,
  type AcceptsEntry,
} from '../x402.js';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAYEE = '0x1111111111111111111111111111111111111111';
const PAYER = '0x9dBA414637c611a16BEa6f0796BFcbcBdc410df8';

// A real 32-byte key, so signatures are genuinely produced.
const PRIVATE_KEY = new Uint8Array(32).fill(7);

function entry(overrides: Partial<AcceptsEntry> = {}): AcceptsEntry {
  return {
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '6000',
    asset: USDC_BASE,
    payTo: PAYEE,
    maxTimeoutSeconds: 300,
    extra: { name: 'USD Coin', version: '2' },
    ...overrides,
  };
}

function decode(header: string): any {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(header), (c) => c.charCodeAt(0))));
}

describe('entryChainId', () => {
  it('reads CAIP-2 ids', () => {
    expect(entryChainId('eip155:8453')).toBe(8453);
    expect(entryChainId('eip155:1')).toBe(1);
    expect(entryChainId('eip155:137')).toBe(137);
  });

  it('still accepts legacy bare names', () => {
    expect(entryChainId('base')).toBe(8453);
  });

  it('rejects chains the wallet cannot sign an exact payment on', () => {
    expect(entryChainId('bitcoin')).toBeNull();
    expect(entryChainId('solana')).toBeNull();
    expect(entryChainId(undefined)).toBeNull();
  });
});

describe('entryAmount', () => {
  it('reads the v2 field and the v1 one', () => {
    expect(entryAmount({ amount: '6000' })).toBe('6000');
    expect(entryAmount({ maxAmountRequired: '6000' })).toBe('6000');
  });

  it('throws when an option names no amount', () => {
    expect(() => entryAmount({})).toThrow(/no amount/i);
  });
});

describe('selectPayableEntry', () => {
  it('picks a payable option', () => {
    expect(selectPayableEntry({ accepts: [entry()] })?.asset).toBe(USDC_BASE);
  });

  it("honours the merchant's ordering", () => {
    const first = entry({ network: 'eip155:1', asset: '0xAAA0000000000000000000000000000000000000' });
    expect(selectPayableEntry({ accepts: [first, entry()] })?.network).toBe('eip155:1');
  });

  it('skips chains the wallet cannot sign', () => {
    const btc = entry({ network: 'bitcoin', asset: 'BTC' });
    expect(selectPayableEntry({ accepts: [btc, entry()] })?.network).toBe('eip155:8453');
  });

  it('skips an option with no token domain, which cannot be signed', () => {
    // Without extra.name/version there is no EIP-712 domain to sign against,
    // and guessing one yields a signature that recovers to the wrong address.
    expect(selectPayableEntry({ accepts: [entry({ extra: {} })] })).toBeNull();
    expect(selectPayableEntry({ accepts: [entry({ extra: { name: 'USD Coin' } })] })).toBeNull();
  });

  it('skips an option with no asset or payee', () => {
    expect(selectPayableEntry({ accepts: [entry({ asset: undefined })] })).toBeNull();
    expect(selectPayableEntry({ accepts: [entry({ payTo: undefined })] })).toBeNull();
  });

  it('skips a scheme other than exact', () => {
    expect(selectPayableEntry({ accepts: [entry({ scheme: 'upto' })] })).toBeNull();
  });

  it('tolerates a malformed 402 body', () => {
    expect(selectPayableEntry({} as any)).toBeNull();
    expect(selectPayableEntry({ accepts: [] })).toBeNull();
    expect(selectPayableEntry(null as any)).toBeNull();
  });
});

describe('buildAuthorization', () => {
  it('pays the amount and payee the option names', () => {
    const auth = buildAuthorization(entry(), PAYER, 1_000_000);

    expect(auth.from).toBe(PAYER);
    expect(auth.to).toBe(PAYEE);
    expect(auth.value).toBe('6000');
    expect(auth.validBefore).toBe(String(1_000_000 + 300));
  });

  it('leaves validAfter at 0, so clock skew cannot make it briefly invalid', () => {
    expect(buildAuthorization(entry(), PAYER).validAfter).toBe('0');
  });

  it('mints a fresh 32-byte nonce each time', () => {
    const nonces = new Set(
      Array.from({ length: 25 }, () => buildAuthorization(entry(), PAYER).nonce),
    );
    expect(nonces.size).toBe(25);
    for (const nonce of nonces) expect(nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('defaults the validity window when the option gives none', () => {
    const auth = buildAuthorization(entry({ maxTimeoutSeconds: undefined }), PAYER, 0);
    expect(auth.validBefore).toBe('600');
  });
});

describe('randomNonce', () => {
  it('is 32 bytes of hex', () => {
    expect(randomNonce()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('signX402Payment', () => {
  it('produces a decodable v2 payment', () => {
    const auth = buildAuthorization(entry(), PAYER);
    const payment = decode(signX402Payment(entry(), auth, PRIVATE_KEY));

    expect(payment.x402Version).toBe(2);
    expect(payment.scheme).toBe('exact');
    expect(payment.network).toBe('eip155:8453');
    expect(payment.payload.authorization).toEqual(auth);
    expect(payment.payload.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('normalises a legacy network name to CAIP-2', () => {
    // The facilitator should see a standard proof regardless of how the offer
    // happened to name the chain.
    const legacy = entry({ network: 'base' });
    const payment = decode(signX402Payment(legacy, buildAuthorization(legacy, PAYER), PRIVATE_KEY));
    expect(payment.network).toBe('eip155:8453');
  });

  it('refuses an option with no token domain', () => {
    const bad = entry({ extra: {} });
    expect(() => signX402Payment(bad, buildAuthorization(bad, PAYER), PRIVATE_KEY)).toThrow(
      /EIP-712 domain/i,
    );
  });

  it('refuses an unsupported network', () => {
    const bad = entry({ network: 'solana' });
    expect(() => signX402Payment(bad, buildAuthorization(bad, PAYER), PRIVATE_KEY)).toThrow(
      /unsupported network/i,
    );
  });
});

describe('encodePaymentHeader', () => {
  it('survives non-ASCII', () => {
    const header = encodePaymentHeader({ note: 'café — 支払い' });
    expect(decode(header).note).toBe('café — 支払い');
  });
});

describe('formatAmount', () => {
  it('scales smallest units into a readable figure', () => {
    expect(formatAmount({ amount: '6000' })).toBe('0.006');
    expect(formatAmount({ amount: '1000000' })).toBe('1');
    expect(formatAmount({ amount: '1500000' })).toBe('1.5');
    expect(formatAmount({ amount: '0' })).toBe('0');
  });

  it('does not lose precision on large amounts', () => {
    expect(formatAmount({ amount: '123456789012345' })).toBe('123456789.012345');
  });
});

describe('summarizeX402', () => {
  it('describes the payment in terms a person can check', () => {
    const summary = summarizeX402(entry({ resource: 'https://api.example.com/premium' }));

    expect(summary).toMatchObject({
      network: 'Base',
      chainId: 8453,
      amount: '0.006',
      assetSymbol: 'USD Coin',
      payTo: PAYEE,
      resource: 'https://api.example.com/premium',
    });
  });

  it('names each supported chain', () => {
    expect(summarizeX402(entry({ network: 'eip155:1' })).network).toBe('Ethereum');
    expect(summarizeX402(entry({ network: 'eip155:137' })).network).toBe('Polygon');
  });

  it('refuses to summarise an unsupported network', () => {
    expect(() => summarizeX402(entry({ network: 'solana' }))).toThrow(/unsupported network/i);
  });
});
