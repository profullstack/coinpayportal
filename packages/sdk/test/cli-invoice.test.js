/**
 * CLI Invoice Command Tests
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
        COINPAY_API_KEY: 'cp_test_invoice_key',
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

describe('CLI Invoice Commands', () => {
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

  it('shows invoice commands in global help', async () => {
    const result = await runCLI(['--help'], baseUrl);

    expect(result.status).toBe(0);
    expect(result.output).toContain('invoice');
    expect(result.output).toContain('Create a draft invoice');
    expect(result.output).toContain('Get invoice details');
  });

  it('creates a draft invoice and emits clean JSON', async () => {
    respond = () => ({
      status: 201,
      body: {
        success: true,
        invoice: {
          id: 'inv_123',
          invoice_number: 'INV-001',
          business_id: 'biz_123',
          client_id: 'cli_123',
          currency: 'USD',
          amount: 125.5,
          crypto_currency: 'USDC',
          status: 'draft',
          due_date: '2026-09-01',
          notes: 'August work',
          created_at: '2026-08-12T00:00:00.000Z',
        },
      },
    });

    const result = await runCLI(
      [
        'invoice',
        'create',
        '--business-id',
        'biz_123',
        '--client-id',
        'cli_123',
        '--amount',
        '125.50',
        '--currency',
        'usd',
        '--crypto-currency',
        'usdc',
        '--due-date',
        '2026-09-01',
        '--notes',
        'August work',
        '--json',
      ],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: 'inv_123',
      invoiceNumber: 'INV-001',
      amount: 125.5,
      currency: 'USD',
      status: 'draft',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/invoices',
      body: {
        business_id: 'biz_123',
        client_id: 'cli_123',
        currency: 'USD',
        amount: 125.5,
        crypto_currency: 'USDC',
        due_date: '2026-09-01',
        notes: 'August work',
      },
    });
    expect(requests[0].body).not.toHaveProperty('schedule');
    expect(requests[0].headers.authorization).toBe('Bearer cp_test_invoice_key');
  });

  it('allows API-key scoped creation without --business-id', async () => {
    respond = () => ({
      status: 201,
      body: {
        success: true,
        invoice: {
          id: 'inv_scoped',
          invoice_number: 'INV-002',
          business_id: 'biz_from_key',
          currency: 'USD',
          amount: 10,
          status: 'draft',
        },
      },
    });

    const result = await runCLI(['invoice', 'create', '--amount', '10', '--json'], baseUrl);

    expect(result.status).toBe(0);
    expect(requests[0].body).not.toHaveProperty('business_id');
    expect(requests[0].body).toMatchObject({ amount: 10, currency: 'USD' });
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '12usd', '0x1A', '1e3', '10.005'])(
    'rejects invalid create amount %s before making a request',
    async (amount) => {
      const result = await runCLI(['invoice', 'create', '--amount', amount], baseUrl);

      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/positive (?:number|decimal)|requires a value/i);
      expect(requests).toHaveLength(0);
    }
  );

  it('rejects missing flag values and invalid dates', async () => {
    const missingValue = await runCLI(['invoice', 'create', '--amount'], baseUrl);
    expect(missingValue.status).not.toBe(0);
    expect(missingValue.output).toContain('--amount requires a value');

    const invalidDate = await runCLI(
      ['invoice', 'create', '--amount', '25', '--due-date', 'not-a-date'],
      baseUrl
    );
    expect(invalidDate.status).not.toBe(0);
    expect(invalidDate.output).toMatch(/due-date.*valid date/i);

    const ambiguousDate = await runCLI(
      ['invoice', 'create', '--amount', '25', '--due-date', '5'],
      baseUrl
    );
    expect(ambiguousDate.status).not.toBe(0);
    expect(ambiguousDate.output).toMatch(/due-date.*YYYY-MM-DD/i);

    const impossibleDate = await runCLI(
      ['invoice', 'create', '--amount', '25', '--due-date', '2026-02-30'],
      baseUrl
    );
    expect(impossibleDate.status).not.toBe(0);
    expect(impossibleDate.output).toMatch(/due-date.*YYYY-MM-DD/i);
    expect(requests).toHaveLength(0);
  });

  it('forwards wallet routing fields when creating a draft', async () => {
    respond = () => ({
      status: 201,
      body: {
        success: true,
        invoice: { id: 'inv_wallet', currency: 'USD', amount: 25, status: 'draft' },
      },
    });

    const result = await runCLI(
      [
        'invoice',
        'create',
        '--amount',
        '25',
        '--wallet-id',
        'wal_123',
        '--merchant-wallet-address',
        '0xabc123',
        '--json',
      ],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(requests[0].body).toMatchObject({
      wallet_id: 'wal_123',
      merchant_wallet_address: '0xabc123',
    });
    expect(requests[0].body).not.toHaveProperty('schedule');
  });

  it('forwards every supported list filter and emits JSON', async () => {
    respond = () => ({
      body: {
        success: true,
        total: 1,
        invoices: [
          {
            id: 'inv_list',
            invoice_number: 'INV-010',
            business_id: 'biz_123',
            client_id: 'cli_123',
            currency: 'USD',
            amount: 50,
            status: 'sent',
            created_at: '2026-08-10T12:00:00.000Z',
          },
        ],
      },
    });

    const result = await runCLI(
      [
        'invoice',
        'list',
        '--business-id',
        'biz_123',
        '--status',
        'SENT',
        '--client-id',
        'cli_123',
        '--date-from',
        '2026-08-01',
        '--date-to',
        '2026-08-31',
        '--json',
      ],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      total: 1,
      invoices: [{ id: 'inv_list', invoiceNumber: 'INV-010', status: 'sent' }],
    });
    expect(requests[0].url).toBe(
      '/api/invoices?business_id=biz_123&status=sent&client_id=cli_123&date_from=2026-08-01&date_to=2026-08-31'
    );
  });

  it('rejects unsupported statuses and reversed date ranges', async () => {
    const badStatus = await runCLI(['invoice', 'list', '--status', 'rejected'], baseUrl);
    expect(badStatus.status).not.toBe(0);
    expect(badStatus.output).toMatch(/status must be one of/i);

    const badDate = await runCLI(['invoice', 'list', '--date-from', '5'], baseUrl);
    expect(badDate.status).not.toBe(0);
    expect(badDate.output).toMatch(/date-from.*YYYY-MM-DD/i);

    const badRange = await runCLI(
      ['invoice', 'list', '--date-from', '2026-09-01', '--date-to', '2026-08-01'],
      baseUrl
    );
    expect(badRange.status).not.toBe(0);
    expect(badRange.output).toMatch(/date-from must not be later/i);
    expect(requests).toHaveLength(0);
  });

  it('prints readable invoice details for get', async () => {
    respond = () => ({
      body: {
        success: true,
        invoice: {
          id: 'inv_get',
          invoice_number: 'INV-011',
          business_id: 'biz_123',
          currency: 'EUR',
          amount: 80,
          status: 'sent',
          notes: 'Design review',
        },
      },
    });

    const result = await runCLI(['invoice', 'get', 'inv_get'], baseUrl);

    expect(result.status).toBe(0);
    expect(result.output).toContain('INV-011');
    expect(result.output).toContain('ID: inv_get');
    expect(result.output).toContain('Status: sent');
    expect(result.output).toContain('Amount: 80 EUR');
    expect(requests[0].url).toBe('/api/invoices/inv_get');
  });

  it('encodes invoice ids before requesting them', async () => {
    respond = () => ({
      body: {
        success: true,
        invoice: { id: 'inv#1/../payments', status: 'draft' },
      },
    });

    const result = await runCLI(['invoice', 'get', 'inv#1/../payments', '--json'], baseUrl);

    expect(result.status).toBe(0);
    expect(requests[0].url).toBe('/api/invoices/inv%231%2F..%2Fpayments');
  });

  it('requires an id for get', async () => {
    const result = await runCLI(['invoice', 'get'], baseUrl);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('coinpay invoice get <id>');
    expect(requests).toHaveLength(0);
  });

  it('returns a non-zero status and useful error for API failures', async () => {
    respond = () => ({ status: 422, body: { error: 'Invoice could not be created' } });

    const result = await runCLI(['invoice', 'create', '--amount', '25'], baseUrl);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invoice could not be created');
    expect(result.stderr).not.toContain('cp_test_invoice_key');
  });
});
