/**
 * CLI OAuth Command Tests
 *
 * The OAuth routes wrap the record: POST and GET /api/oauth/clients return
 * { success, client: {...} }. The CLI used to read client_id/client_secret off
 * the top level, so `coinpay oauth create` printed only the success line and
 * the one-time secret was lost. These tests pin the wrapped shape.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dirname, '..', 'bin', 'coinpay.js');

function runCLI(args, baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        ...process.env,
        COINPAY_API_KEY: 'cp_test_oauth_key',
        COINPAY_BASE_URL: baseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ status: code, stdout, stderr, output: stdout + stderr });
    });
  });
}

function clientFixture(overrides = {}) {
  return {
    id: 'uuid-1',
    client_id: 'cp_oauth_abc123',
    name: 'My App',
    description: 'Test application',
    redirect_uris: ['https://myapp.com/callback'],
    scopes: ['openid', 'profile'],
    created_at: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('CLI OAuth Commands', () => {
  let server;
  let baseUrl;
  let requests;
  let respond;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const captured = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: rawBody ? JSON.parse(rawBody) : undefined,
      };
      requests.push(captured);

      const result = await respond(captured);
      response.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result.body));
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    baseUrl = 'http://127.0.0.1:' + address.port + '/api';
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requests = [];
    respond = () => ({ status: 404, body: { error: 'Unexpected request' } });
  });

  it('oauth create requires --name and --redirect-uri', async () => {
    const result = await runCLI(['oauth', 'create', '--name', 'My App'], baseUrl);
    expect(result.output).toContain('--redirect-uri');
    expect(requests).toHaveLength(0);
  });

  it('oauth create prints the client id and one-time secret from the wrapped response', async () => {
    respond = ({ method, url }) => {
      if (method === 'POST' && url === '/api/oauth/clients') {
        return {
          status: 201,
          body: {
            success: true,
            client: clientFixture({ client_secret: 'cp_secret_only_shown_once' }),
            warning: 'Store the client_secret securely. It will not be shown again.',
          },
        };
      }
      return { status: 404, body: { error: 'Unexpected request' } };
    };

    const result = await runCLI(
      [
        'oauth', 'create',
        '--name', 'My App',
        '--redirect-uri', 'https://myapp.com/callback',
        '--scope', 'openid,profile',
      ],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      name: 'My App',
      redirect_uris: ['https://myapp.com/callback'],
      scopes: ['openid', 'profile'],
    });

    expect(result.output).toContain('OAuth client created');
    expect(result.output).toContain('Client ID:');
    expect(result.output).toContain('cp_oauth_abc123');
    expect(result.output).toContain('Client Secret:');
    expect(result.output).toContain('cp_secret_only_shown_once');
    expect(result.output).toContain('only shown once');
  });

  it('oauth create still prints an unwrapped record', async () => {
    respond = () => ({
      status: 201,
      body: clientFixture({ client_secret: 'cp_secret_bare' }),
    });

    const result = await runCLI(
      ['oauth', 'create', '--name', 'My App', '--redirect-uri', 'https://myapp.com/callback'],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain('cp_oauth_abc123');
    expect(result.output).toContain('cp_secret_bare');
  });

  it('oauth create --json prints the full API response', async () => {
    respond = () => ({
      status: 201,
      body: {
        success: true,
        client: clientFixture({ client_secret: 'cp_secret_json' }),
        warning: 'Store the client_secret securely. It will not be shown again.',
      },
    });

    const result = await runCLI(
      ['oauth', 'create', '--name', 'My App', '--redirect-uri', 'https://myapp.com/callback', '--json'],
      baseUrl
    );

    expect(result.status).toBe(0);
    const jsonStart = result.stdout.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(result.stdout.slice(jsonStart));
    expect(parsed.success).toBe(true);
    expect(parsed.client.client_secret).toBe('cp_secret_json');
  });

  it('oauth get prints the client details from the wrapped response', async () => {
    respond = ({ method, url }) => {
      if (method === 'GET' && url === '/api/oauth/clients/cp_oauth_abc123') {
        return { status: 200, body: { success: true, client: clientFixture() } };
      }
      return { status: 404, body: { error: 'Unexpected request' } };
    };

    const result = await runCLI(['oauth', 'get', 'cp_oauth_abc123'], baseUrl);

    expect(result.status).toBe(0);
    expect(result.output).toContain('OAuth Client: My App');
    expect(result.output).toContain('Client ID: cp_oauth_abc123');
    expect(result.output).toContain('Description: Test application');
    expect(result.output).toContain('Redirect URIs: https://myapp.com/callback');
    expect(result.output).toContain('Scopes: openid, profile');
    expect(result.output).toContain('Created: 2026-09-10T00:00:00.000Z');
  });

  it('oauth list prints each client from the clients array', async () => {
    respond = () => ({
      status: 200,
      body: {
        success: true,
        clients: [clientFixture(), clientFixture({ client_id: 'cp_oauth_def456', name: 'Other App' })],
      },
    });

    const result = await runCLI(['oauth', 'list'], baseUrl);

    expect(result.status).toBe(0);
    expect(result.output).toContain('OAuth Clients');
    expect(result.output).toContain('cp_oauth_abc123');
    expect(result.output).toContain('cp_oauth_def456');
    expect(result.output).toContain('Other App');
  });
});
