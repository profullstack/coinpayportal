import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import {
  parseAccessUrl,
  decodeSetupToken,
  redactAccessUrl,
  parseAmount,
  unixToIso,
  collectErrors,
  collectProviderErrors,
  claimSetupToken,
  ClaimError,
  assertAllowedProviderUrl,
  allowedProviderHosts,
  DEFAULT_ALLOWED_HOSTS,
  fetchAccountSet,
  ProviderRequestError,
} from './simplefin';

// The fixtures below use example hosts; allow them for the duration of this file.
const ORIGINAL_ALLOWED = process.env.FINANCES_SIMPLEFIN_ALLOWED_HOSTS;
beforeAll(() => {
  process.env.FINANCES_SIMPLEFIN_ALLOWED_HOSTS = 'bridge.example,host.example,beta-bridge.simplefin.org';
});
afterAll(() => {
  if (ORIGINAL_ALLOWED === undefined) delete process.env.FINANCES_SIMPLEFIN_ALLOWED_HOSTS;
  else process.env.FINANCES_SIMPLEFIN_ALLOWED_HOSTS = ORIGINAL_ALLOWED;
});

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
    expect(parseAmount('-1500.00')).toBe(-1500.00);
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

  it('keeps an unrecognised object as a generic warning rather than dropping it', () => {
    expect(collectErrors({ accounts: [], errors: ['  '], errlist: [{ nope: 1 }] })).toEqual([
      'Provider reported an error (gen.) in an unrecognised format',
    ]);
  });

  it('reads the 2.0 draft `msg` field and preserves the scope', () => {
    // The draft spells the text `msg`, not `message`. Reading only the old
    // spellings would drop the one sentence that says which bank broke.
    const errors = collectProviderErrors({
      accounts: [],
      errlist: [
        { code: 'con.auth', msg: 'Example Bank needs re-authentication', conn_id: 'conn-7' },
        { code: 'act.missingdata', msg: 'Balance unavailable', conn_id: 'conn-7', account_id: 'acct-1' },
        { code: 'gen.api', msg: 'Try again later' },
      ],
    });
    expect(errors).toEqual([
      { code: 'con.auth', message: 'Example Bank needs re-authentication', connId: 'conn-7', accountId: null },
      { code: 'act.missingdata', message: 'Balance unavailable', connId: 'conn-7', accountId: 'acct-1' },
      { code: 'gen.api', message: 'Try again later', connId: null, accountId: null },
    ]);
  });
});

describe('assertAllowedProviderUrl', () => {
  it('allows the bridge hosts by default', () => {
    expect(allowedProviderHosts({})).toEqual(DEFAULT_ALLOWED_HOSTS);
    expect(() =>
      assertAllowedProviderUrl('https://beta-bridge.simplefin.org/simplefin/claim/X', { allowedHosts: DEFAULT_ALLOWED_HOSTS }),
    ).not.toThrow();
  });

  it('blocks everything a forged token could point at', () => {
    const allowed = { allowedHosts: DEFAULT_ALLOWED_HOSTS };
    const blocked = [
      'http://beta-bridge.simplefin.org/simplefin/claim/X', // plain http
      'https://localhost/claim',
      'https://127.0.0.1/claim',
      'https://10.0.0.5/claim',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/claim',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://beta-bridge.simplefin.org:8443/simplefin',
      'https://attacker.example/claim',
      'https://0x7f000001/claim',
      'https://2130706433/claim',
      'https://evil.local/claim',
    ];
    for (const url of blocked) {
      expect(() => assertAllowedProviderUrl(url, allowed), url).toThrow();
    }
  });

  it('honours the environment override', () => {
    expect(allowedProviderHosts({ FINANCES_SIMPLEFIN_ALLOWED_HOSTS: 'Bridge.Internal.Example, other.example' })).toEqual([
      'bridge.internal.example',
      'other.example',
    ]);
  });
});

describe('fetchAccountSet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the selected protocol version, sends credentials as a header and never follows redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ accounts: [], connections: [], errlist: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchAccountSet('https://user:pass@bridge.example/simplefin', {
      version: 2,
      startDate: new Date('2026-08-01T00:00:00Z'),
      endDate: new Date('2026-09-01T00:00:00Z'),
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bridge.example/simplefin/accounts?version=2&start-date=1785542400&end-date=1788220800');
    expect(url).not.toContain('pass');
    expect(init.redirect).toBe('manual');
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it('refuses to send credentials to a host outside the allowlist', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchAccountSet('https://user:pass@attacker.example/simplefin')).rejects.toThrow(/not an approved/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps provider status codes to stable error codes', async () => {
    const respond = (status: number, headers: Record<string, string> = {}) =>
      vi.fn().mockResolvedValue({ ok: false, status, headers: new Headers(headers), text: async () => '' });

    vi.stubGlobal('fetch', respond(402));
    await expect(fetchAccountSet('https://u:p@bridge.example/simplefin')).rejects.toMatchObject({ code: 'provider_payment_required' });

    vi.stubGlobal('fetch', respond(403));
    await expect(fetchAccountSet('https://u:p@bridge.example/simplefin')).rejects.toMatchObject({ code: 'provider_reconnect_required' });

    vi.stubGlobal('fetch', respond(429, { 'retry-after': '120' }));
    const err = await fetchAccountSet('https://u:p@bridge.example/simplefin').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderRequestError);
    expect(err.code).toBe('provider_rate_limited');
    expect(err.retryAfterMs).toBe(120_000);

    vi.stubGlobal('fetch', respond(302, { location: 'https://elsewhere.example' }));
    await expect(fetchAccountSet('https://u:p@bridge.example/simplefin')).rejects.toThrow(/redirect/);
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

  it('never POSTs a claim to a host outside the allowlist', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const forged = Buffer.from('https://169.254.169.254/latest/meta-data/').toString('base64');
    await expect(claimSetupToken(forged)).rejects.toThrow(/not allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the claim with redirects disabled and treats one as an unknown outcome', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 302, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const err = await claimSetupToken(token).catch((e) => e);
    expect(err).toBeInstanceOf(ClaimError);
    expect(err.outcome).toBe('unknown');
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });

  it('reports a timeout as an uncertain outcome, so nobody replays the claim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    const err = await claimSetupToken(token).catch((e) => e);
    expect(err).toBeInstanceOf(ClaimError);
    expect(err.outcome).toBe('unknown');
    expect(err.message).toMatch(/disable it at the bridge/);
  });

  it('rejects an access URL on another host even though the token is now spent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'https://u:p@attacker.example/simplefin' }),
    );
    await expect(claimSetupToken(token)).rejects.toThrow(/not an approved/);
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
