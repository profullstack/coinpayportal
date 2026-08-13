/**
 * Web Bot Auth verification tests
 *
 * Signatures are generated with real Ed25519 keys rather than mocked, because
 * the thing most likely to be wrong is the signature base — and a mocked
 * verifier would happily agree with a base that no real signer produces.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
import {
  verifyWebBotAuth,
  buildSignatureBase,
  parseSignatureInput,
  parseSignatureHeader,
  jwkThumbprint,
  directoryUrlFor,
  clearDirectoryCache,
  type Ed25519Jwk,
} from './index';

const AGENT = 'https://signature-agent.test';
const URL_UNDER_TEST = 'https://api.example.com/premium?tier=gold';

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as unknown as Ed25519Jwk;
  return { privateKey, jwk, keyid: jwkThumbprint(jwk) };
}

/**
 * Sign a request the way a conforming bot would: build the base from the
 * params we are about to put on the wire, then sign those exact bytes.
 */
function signRequest({
  privateKey,
  keyid,
  components = ['@authority', 'signature-agent'],
  created = 1735689600,
  expires = 1735689600 + 300,
  tag = 'web-bot-auth',
  label = 'sig1',
  agent = AGENT,
  url = URL_UNDER_TEST,
  method = 'GET',
  extraHeaders = {} as Record<string, string>,
}: any) {
  const componentList = components.map((c: string) => `"${c}"`).join(' ');
  const params =
    `(${componentList});created=${created};keyid="${keyid}"` +
    `;alg="ed25519";expires=${expires};tag="${tag}"`;

  const headers: Record<string, string> = {
    'signature-agent': `"${agent}"`,
    'signature-input': `${label}=${params}`,
    ...extraHeaders,
  };

  const entry = parseSignatureInput(headers['signature-input']).get(label)!;
  const base = buildSignatureBase(entry, { method, url, headers });
  const sig = cryptoSign(null, Buffer.from(base, 'utf-8'), privateKey);

  headers.signature = `${label}=:${sig.toString('base64')}:`;
  return { headers, base, method, url };
}

describe('signature base construction', () => {
  it('produces exactly the RFC 9421 line format', () => {
    const input =
      'sig1=("@authority" "signature-agent");created=1735689600;keyid="abc";alg="ed25519";expires=1735693200;tag="web-bot-auth"';
    const entry = parseSignatureInput(input).get('sig1')!;

    const base = buildSignatureBase(entry, {
      method: 'GET',
      url: 'https://api.example.com/premium',
      headers: { 'signature-agent': `"${AGENT}"` },
    });

    expect(base).toBe(
      '"@authority": api.example.com\n' +
        `"signature-agent": "${AGENT}"\n` +
        '"@signature-params": ("@authority" "signature-agent");created=1735689600;keyid="abc";alg="ed25519";expires=1735693200;tag="web-bot-auth"'
    );
  });

  it('reuses the signer\'s parameter text verbatim rather than re-serializing', () => {
    // Unusual but legal ordering and spacing. Re-serializing would normalize
    // it, change the bytes, and break every signature from this signer.
    const input =
      'sig1=("@authority");tag="web-bot-auth";keyid="abc";created=1;alg="ed25519"';
    const entry = parseSignatureInput(input).get('sig1')!;

    const base = buildSignatureBase(entry, {
      method: 'GET',
      url: 'https://api.example.com/x',
      headers: {},
    });

    expect(base.endsWith(
      '"@signature-params": ("@authority");tag="web-bot-auth";keyid="abc";created=1;alg="ed25519"'
    )).toBe(true);
  });

  it('resolves derived components', () => {
    const input = 'sig1=("@method" "@path" "@query" "@scheme");tag="web-bot-auth"';
    const entry = parseSignatureInput(input).get('sig1')!;

    const base = buildSignatureBase(entry, {
      method: 'post',
      url: 'https://api.example.com/a/b?x=1',
      headers: {},
    });

    expect(base).toContain('"@method": POST');
    expect(base).toContain('"@path": /a/b');
    expect(base).toContain('"@query": ?x=1');
    expect(base).toContain('"@scheme": https');
  });

  it('lowercases the authority and keeps a non-default port', () => {
    const entry = parseSignatureInput('sig1=("@authority");tag="web-bot-auth"').get('sig1')!;
    const base = buildSignatureBase(entry, {
      method: 'GET',
      url: 'https://API.Example.COM:8443/x',
      headers: {},
    });
    expect(base).toContain('"@authority": api.example.com:8443');
  });

  it('throws when a covered component is absent from the request', () => {
    const entry = parseSignatureInput('sig1=("x-not-sent");tag="web-bot-auth"').get('sig1')!;
    expect(() =>
      buildSignatureBase(entry, { method: 'GET', url: 'https://a.test/x', headers: {} })
    ).toThrow(/Cannot resolve/);
  });
});

describe('structured field parsing', () => {
  it('does not split on commas inside quoted strings or inner lists', () => {
    const input =
      'sig1=("@authority" "signature-agent");keyid="a,b";tag="web-bot-auth", sig2=("@path");tag="other"';
    const parsed = parseSignatureInput(input);

    expect(parsed.size).toBe(2);
    expect(parsed.get('sig1')!.params.keyid).toBe('a,b');
    expect(parsed.get('sig1')!.components).toEqual(['@authority', 'signature-agent']);
    expect(parsed.get('sig2')!.components).toEqual(['@path']);
  });

  it('parses byte sequences per label', () => {
    const sigs = parseSignatureHeader('sig1=:AAEC:, sig2=:/w==:');
    expect([...sigs.get('sig1')!]).toEqual([0, 1, 2]);
    expect([...sigs.get('sig2')!]).toEqual([255]);
  });

  it('reads integer params as numbers and quoted params as strings', () => {
    const entry = parseSignatureInput(
      'sig1=("@authority");created=1735689600;keyid="abc";tag="web-bot-auth"'
    ).get('sig1')!;
    expect(entry.params.created).toBe(1735689600);
    expect(entry.params.keyid).toBe('abc');
  });
});

describe('jwkThumbprint', () => {
  it('matches the RFC 7638 canonical form', () => {
    // Canonical JSON is {"crv":...,"kty":...,"x":...} with no whitespace.
    const jwk: Ed25519Jwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
    };
    expect(jwkThumbprint(jwk)).toBe('kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k');
  });

  it('changes when the key changes', () => {
    const a = makeKeypair();
    const b = makeKeypair();
    expect(a.keyid).not.toBe(b.keyid);
  });
});

describe('directoryUrlFor', () => {
  it('appends the well-known path to a bare origin', () => {
    expect(directoryUrlFor('"https://bot.example"').toString()).toBe(
      'https://bot.example/.well-known/http-message-signatures-directory'
    );
  });

  it('keeps an explicit path', () => {
    expect(directoryUrlFor('https://bot.example/keys.json').toString()).toBe(
      'https://bot.example/keys.json'
    );
  });

  it('refuses non-https', () => {
    expect(() => directoryUrlFor('http://bot.example')).toThrow(/https/);
  });

  it.each([
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://169.254.169.254/x',
    'https://172.16.0.1/x',
  ])('refuses to fetch from %s', (url) => {
    expect(() => directoryUrlFor(url)).toThrow(/Refusing/);
  });
});

describe('verifyWebBotAuth', () => {
  let key: ReturnType<typeof makeKeypair>;
  let directory: (agent: string) => Promise<Ed25519Jwk[]>;

  beforeEach(() => {
    clearDirectoryCache();
    key = makeKeypair();
    directory = async () => [key.jwk];
  });

  const now = 1735689600 + 10;

  it('verifies a correctly signed request', async () => {
    const req = signRequest({ privateKey: key.privateKey, keyid: key.keyid });

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });

    expect(result.verified).toBe(true);
    if (!result.verified) throw new Error('expected verified');
    expect(result.keyid).toBe(key.keyid);
    expect(result.agentOrigin).toBe('https://signature-agent.test');
    expect(result.coveredComponents).toContain('@authority');
  });

  it('rejects a signature made for a different authority', async () => {
    // The whole point of covering @authority: a signature captured at one
    // origin must not be replayable against another.
    const req = signRequest({
      privateKey: key.privateKey,
      keyid: key.keyid,
      url: 'https://other.example.com/premium?tier=gold',
    });

    const result = await verifyWebBotAuth(
      { ...req, url: URL_UNDER_TEST },
      { now, resolveDirectory: directory }
    );

    expect(result).toMatchObject({ verified: false, reason: 'bad_signature' });
  });

  it('rejects a tampered signature', async () => {
    const req = signRequest({ privateKey: key.privateKey, keyid: key.keyid });
    const bytes = Buffer.from(req.headers.signature.split(':')[1], 'base64');
    bytes[0] ^= 0xff;
    req.headers.signature = `sig1=:${bytes.toString('base64')}:`;

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'bad_signature' });
  });

  it('rejects a signature from a key that is not in the directory', async () => {
    const other = makeKeypair();
    const req = signRequest({ privateKey: other.privateKey, keyid: other.keyid });

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'unknown_key' });
  });

  it('rejects a keyid that does not match the key that signed', async () => {
    // Claiming a directory key's id while signing with another key.
    const other = makeKeypair();
    const req = signRequest({ privateKey: other.privateKey, keyid: key.keyid });

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'bad_signature' });
  });

  it('rejects an expired signature', async () => {
    const req = signRequest({
      privateKey: key.privateKey,
      keyid: key.keyid,
      created: 1735689600,
      expires: 1735689600 + 60,
    });

    const result = await verifyWebBotAuth(req, {
      now: 1735689600 + 60 + 400,
      resolveDirectory: directory,
    });
    expect(result).toMatchObject({ verified: false, reason: 'expired' });
  });

  it('rejects a signature that is not yet valid', async () => {
    const req = signRequest({
      privateKey: key.privateKey,
      keyid: key.keyid,
      created: now + 10_000,
      expires: now + 10_300,
    });

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'not_yet_valid' });
  });

  it('rejects a signature valid for longer than an hour', async () => {
    // A long-lived signature is a bearer token: anyone who sees it can reuse it.
    const req = signRequest({
      privateKey: key.privateKey,
      keyid: key.keyid,
      created: 1735689600,
      expires: 1735689600 + 86_400,
    });

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'lifetime_too_long' });
  });

  it('ignores signatures that are not tagged web-bot-auth', async () => {
    const req = signRequest({ privateKey: key.privateKey, keyid: key.keyid, tag: 'other' });

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'no_web_bot_auth_signature' });
  });

  it('reports an unsigned request without erroring', async () => {
    const result = await verifyWebBotAuth(
      { method: 'GET', url: URL_UNDER_TEST, headers: {} },
      { now, resolveDirectory: directory }
    );
    expect(result).toMatchObject({ verified: false, reason: 'missing_headers' });
  });

  it('requires a Signature-Agent to locate the key', async () => {
    const req = signRequest({ privateKey: key.privateKey, keyid: key.keyid });
    delete (req.headers as any)['signature-agent'];

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'missing_headers' });
  });

  it('surfaces a directory fetch failure distinctly from a bad signature', async () => {
    const req = signRequest({ privateKey: key.privateKey, keyid: key.keyid });

    const result = await verifyWebBotAuth(req, {
      now,
      resolveDirectory: async () => {
        throw new Error('HTTP 503');
      },
    });
    expect(result).toMatchObject({ verified: false, reason: 'directory_error' });
  });

  it('rejects an algorithm other than ed25519', async () => {
    const req = signRequest({ privateKey: key.privateKey, keyid: key.keyid });
    req.headers['signature-input'] = req.headers['signature-input'].replace(
      'alg="ed25519"',
      'alg="rsa-pss-sha512"'
    );

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'unsupported_algorithm' });
  });

  it('verifies when extra components are covered', async () => {
    const req = signRequest({
      privateKey: key.privateKey,
      keyid: key.keyid,
      components: ['@authority', '@method', '@path', 'signature-agent'],
    });

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result.verified).toBe(true);
  });

  it('rejects when a covered header was altered in transit', async () => {
    const req = signRequest({
      privateKey: key.privateKey,
      keyid: key.keyid,
      components: ['@authority', 'x-crawler-budget'],
      extraHeaders: { 'x-crawler-budget': '100' },
    });
    req.headers['x-crawler-budget'] = '999999';

    const result = await verifyWebBotAuth(req, { now, resolveDirectory: directory });
    expect(result).toMatchObject({ verified: false, reason: 'bad_signature' });
  });
});
