import { describe, it, expect } from 'vitest';
import { dcrRedirectAllowed, parseRegistration, DCR_SCOPES } from './dcr';

describe('dcrRedirectAllowed', () => {
  it('accepts the hosted connector callbacks verbatim', () => {
    expect(dcrRedirectAllowed('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(dcrRedirectAllowed('https://claude.com/api/mcp/auth_callback')).toBe(true);
    expect(dcrRedirectAllowed('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
  });

  it('accepts http loopback on any port and path', () => {
    expect(dcrRedirectAllowed('http://localhost:33418/callback')).toBe(true);
    expect(dcrRedirectAllowed('http://127.0.0.1:6274/oauth/callback')).toBe(true);
    expect(dcrRedirectAllowed('http://[::1]:8080/cb')).toBe(true);
  });

  it('refuses everything else', () => {
    for (const uri of [
      'https://evil.example/cb',
      'https://claude.ai/api/mcp/auth_callback?x=1',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'http://claude.ai/api/mcp/auth_callback',
      'https://localhost/cb',
      'http://localhost.evil.example/cb',
      'http://user@localhost:1/cb',
      'http://127.0.0.1:1/cb#frag',
      'javascript:alert(1)',
      'com.example.app:/cb',
      42,
    ]) {
      expect(dcrRedirectAllowed(uri), String(uri)).toBe(false);
    }
  });
});

describe('parseRegistration', () => {
  const claude = { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] };

  it('registers a public client with the MCP scope ceiling by default', () => {
    const r = parseRegistration({ ...claude, token_endpoint_auth_method: 'client_secret_post' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.client.scopes).toEqual([...DCR_SCOPES]);
    expect(r.client.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(r.client.client_name).toBe('Claude');
  });

  it('never grants merchant, wallet:read or did', () => {
    const r = parseRegistration({ ...claude, scope: 'openid merchant wallet:read did invoices' });
    expect(r.ok && r.client.scopes).toEqual(['openid', 'invoices']);
  });

  it('refuses a disallowed redirect, implicit/device grants and token response types', () => {
    expect(parseRegistration({ redirect_uris: ['https://evil.example/cb'] })).toMatchObject({ ok: false, error: { error: 'invalid_redirect_uri' } });
    expect(parseRegistration({ redirect_uris: [] })).toMatchObject({ ok: false, error: { error: 'invalid_redirect_uri' } });
    expect(parseRegistration({ ...claude, grant_types: ['implicit'] })).toMatchObject({ ok: false });
    expect(parseRegistration({ ...claude, grant_types: ['urn:ietf:params:oauth:grant-type:device_code'] })).toMatchObject({ ok: false });
    expect(parseRegistration({ ...claude, response_types: ['token'] })).toMatchObject({ ok: false });
    expect(parseRegistration('nope')).toMatchObject({ ok: false, error: { error: 'invalid_client_metadata' } });
  });

  it('cleans the client name', () => {
    const r = parseRegistration({ ...claude, client_name: '<b>Claude</b>\u0000' + 'x'.repeat(200) });
    expect(r.ok && r.client.client_name.length).toBe(100);
    expect(r.ok && r.client.client_name).not.toMatch(/[<>\u0000]/);
    const unnamed = parseRegistration({ redirect_uris: ['http://127.0.0.1:9/cb'] });
    expect(unnamed.ok && unnamed.client.client_name).toBe('MCP client');
  });
});
