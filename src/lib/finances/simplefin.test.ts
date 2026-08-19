import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseAccessUrl,
  decodeSetupToken,
  redactAccessUrl,
  parseAmount,
  unixToIso,
  collectErrors,
  claimSetupToken,
} from './simplefin';

describe('parseAccessUrl', () => {
  it('splits credentials from the endpoint', () => {
    const parsed = parseAccessUrl('https://user123:pass456@beta-bridge.simplefin.org/simplefin');
    expect(parsed.username).toBe('user123');
    expect(parsed.password).toBe('pass456');
    expect(parsed.baseUrl).toBe('https://beta-bridge.simplefin.org/simplefin');
  });

  it('keeps a password containing @ intact', () => {
    // Only the LAST @ in the authority separates credentials from host, so a
    // password with an @ in it must survive. Splitting on the first @ would
    // silently produce a wrong password and a 401 nobody could explain.
    const parsed = parseAccessUrl('https://user:p@ss@host.example/simplefin');
    expect(parsed.username).toBe('user');
    expect(parsed.password).toBe('p@ss');
    expect(parsed.baseUrl).toBe('https://host.example/simplefin');
  });

  it('keeps a password containing a colon intact', () => {
    const parsed = parseAccessUrl('https://user:a:b:c@host.example/simplefin');
    expect(parsed.password).toBe('a:b:c');
  });

  it('does not percent-decode the credential', () => {
    // `new URL()` would turn %2F into '/' and corrupt the secret.
    const parsed = parseAccessUrl('https://user:a%2Fb%40c@host.example/simplefin');
    expect(parsed.password).toBe('a%2Fb%40c');
  });

  it('strips a trailing slash so paths join cleanly', () => {
    expect(parseAccessUrl('https://u:p@host.example/simplefin/').baseUrl).toBe(
      'https://host.example/simplefin',
    );
  });

  it('rejects a URL with no credentials', () => {
    expect(() => parseAccessUrl('https://host.example/simplefin')).toThrow(/credentials/i);
  });

  it('rejects a URL with no scheme', () => {
    expect(() => parseAccessUrl('u:p@host.example/simplefin')).toThrow(/scheme/i);
  });
});

describe('redactAccessUrl', () => {
  it('removes the credential from anything loggable', () => {
    expect(redactAccessUrl('failed GET https://user:secret@host/simplefin/accounts')).toBe(
      'failed GET https://***:***@host/simplefin/accounts',
    );
  });

  it('leaves a credential-free string alone', () => {
    expect(redactAccessUrl('https://host/simplefin')).toBe('https://host/simplefin');
  });
});

describe('decodeSetupToken', () => {
  it('decodes base64 to a claim URL', () => {
    const url = 'https://beta-bridge.simplefin.org/simplefin/claim/ABC123';
    expect(decodeSetupToken(Buffer.from(url).toString('base64'))).toBe(url);
  });

  it('tolerates whitespace from a paste', () => {
    const url = 'https://bridge.example/simplefin/claim/XYZ';
    const token = Buffer.from(url).toString('base64');
    expect(decodeSetupToken(`  ${token.slice(0, 10)}\n${token.slice(10)}  `)).toBe(url);
  });

  it('rejects a token that does not decode to a URL', () => {
    expect(() => decodeSetupToken(Buffer.from('not a url').toString('base64'))).toThrow(/https/i);
  });

  it('rejects an empty token', () => {
    expect(() => decodeSetupToken('   ')).toThrow(/empty/i);
  });
});

describe('parseAmount', () => {
  it('parses the decimal strings SimpleFIN sends', () => {
    expect(parseAmount('-2653.49')).toBe(-2653.49);
    expect(parseAmount('0.00')).toBe(0);
    expect(parseAmount('1,234.56')).toBe(1234.56);
  });

  it('returns null rather than NaN for junk', () => {
    // NaN would propagate into every sum downstream and turn one bad row into
    // a blank balance sheet.
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it('accepts a number as-is', () => {
    expect(parseAmount(12.5)).toBe(12.5);
    expect(parseAmount(Number.NaN)).toBeNull();
  });
});

describe('unixToIso', () => {
  it('converts UNIX seconds', () => {
    expect(unixToIso(1787140800)).toBe(new Date(1787140800000).toISOString());
  });

  it('rejects zero, negatives and non-numbers', () => {
    expect(unixToIso(0)).toBeNull();
    expect(unixToIso(-5)).toBeNull();
    expect(unixToIso('1787140800')).toBeNull();
    expect(unixToIso(undefined)).toBeNull();
  });
});

describe('collectErrors', () => {
  it('reads the v1 `errors` spelling', () => {
    expect(collectErrors({ accounts: [], errors: ['Chase needs reauth'] })).toEqual([
      'Chase needs reauth',
    ]);
  });

  it('reads the v2 `errlist` spelling, including object form', () => {
    expect(
      collectErrors({
        accounts: [],
        errlist: ['plain', { message: 'from object' }, { detail: 'from detail' }],
      }),
    ).toEqual(['plain', 'from object', 'from detail']);
  });

  it('ignores blanks and unrecognised shapes', () => {
    expect(collectErrors({ accounts: [], errors: ['  '], errlist: [{ nope: 1 }] })).toEqual([]);
  });
});

describe('claimSetupToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const token = Buffer.from('https://bridge.example/simplefin/claim/TOKEN').toString('base64');

  it('POSTs the decoded claim URL and returns the access URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'https://user:pass@bridge.example/simplefin\n',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(claimSetupToken(token)).resolves.toBe('https://user:pass@bridge.example/simplefin');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bridge.example/simplefin/claim/TOKEN');
    expect(init.method).toBe('POST');
  });

  it('explains that a 403 means the token is already spent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '' }));
    await expect(claimSetupToken(token)).rejects.toThrow(/already been claimed/i);
  });

  it('rejects a response that is not an access URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'Server error' }),
    );
    await expect(claimSetupToken(token)).rejects.toThrow(/did not return an access URL/i);
  });

  it('rejects an access URL with no credentials, while the operator can still act', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'https://bridge.example/simplefin',
      }),
    );
    await expect(claimSetupToken(token)).rejects.toThrow(/credentials/i);
  });
});
