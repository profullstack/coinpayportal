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

function invoiceFixture(overrides = {}) {
  return {
    id: 'inv_mutation',
    invoice_number: 'INV-020',
    business_id: 'biz_123',
    client_id: 'cli_123',
    currency: 'USD',
    amount: 100,
    crypto_currency: 'USDC',
    status: 'draft',
    due_date: '2026-09-01',
    notes: 'Original scope',
    created_at: '2026-08-17T00:00:00.000Z',
    updated_at: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
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
    expect(result.output).toContain('Update editable fields on a draft invoice');
    expect(result.output).toContain('Create payment details without emailing the client');
    expect(result.output).toContain('Create payment details and email the client');
    expect(result.output).toContain('Permanently delete a draft invoice');
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
    expect(JSON.parse(result.stdout)).not.toHaveProperty('shareUrl');
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

    const result = await runCLI(['invoice', 'create', '--amount', '10'], baseUrl);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('/now/inv_scoped');
    expect(requests[0].body).not.toHaveProperty('business_id');
    expect(requests[0].body).toMatchObject({ amount: 10, currency: 'USD' });
  });

  it('does not advertise a dead payment link for a draft', async () => {
    respond = () => ({
      status: 201,
      body: {
        success: true,
        invoice: {
          id: 'inv_custom',
          invoice_number: 'INV-003',
          currency: 'USD',
          amount: 15,
          status: 'draft',
        },
      },
    });
    const customBaseUrl = new URL('/coinpay/api/', baseUrl).toString();

    const result = await runCLI(
      ['invoice', 'create', '--amount', '15', '--json'],
      customBaseUrl
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).not.toHaveProperty('shareUrl');
    expect(requests[0].url).toBe('/coinpay/api/invoices');
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

  it('updates every editable draft field and emits clean JSON', async () => {
    respond = (request) => {
      if (request.method === 'GET') {
        return { body: { success: true, invoice: invoiceFixture() } };
      }
      return {
        body: {
          success: true,
          invoice: invoiceFixture({
            amount: 125.5,
            currency: 'EUR',
            crypto_currency: 'BTC',
            due_date: '2026-10-01',
            notes: 'Updated scope',
            client_id: 'cli_456',
            wallet_id: 'wal_456',
            merchant_wallet_address: 'bc1qexample',
          }),
        },
      };
    };

    const result = await runCLI(
      [
        'invoice', 'update', 'inv_mutation',
        '--amount', '125.50',
        '--currency', 'eur',
        '--crypto-currency', 'btc',
        '--due-date', '2026-10-01',
        '--notes', 'Updated scope',
        '--client-id', 'cli_456',
        '--wallet-id', 'wal_456',
        '--merchant-wallet-address', 'bc1qexample',
        '--json',
      ],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: 'inv_mutation',
      amount: 125.5,
      currency: 'EUR',
      cryptoCurrency: 'BTC',
      status: 'draft',
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ method: 'GET', url: '/api/invoices/inv_mutation' });
    expect(requests[1]).toMatchObject({
      method: 'PUT',
      url: '/api/invoices/inv_mutation',
      body: {
        amount: 125.5,
        currency: 'EUR',
        crypto_currency: 'BTC',
        due_date: '2026-10-01',
        notes: 'Updated scope',
        client_id: 'cli_456',
        wallet_id: 'wal_456',
        merchant_wallet_address: 'bc1qexample',
      },
    });
    expect(requests[1].body).not.toHaveProperty('status');
    expect(requests[1].body).not.toHaveProperty('tx_hash');
  });

  it('allows clearing notes with --notes=', async () => {
    respond = (request) => ({
      body: {
        success: true,
        invoice: invoiceFixture(request.method === 'PUT' ? { notes: '' } : {}),
      },
    });

    const result = await runCLI(
      ['invoice', 'update', 'inv_mutation', '--notes=', '--json'],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(requests[1].body).toEqual({ notes: '' });
    expect(JSON.parse(result.stdout).notes).toBe('');
  });

  it('explains how to clear notes when --notes has no value', async () => {
    const result = await runCLI(
      ['invoice', 'update', 'inv_mutation', '--notes'],
      baseUrl
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('--notes requires a value; use --notes=');
    expect(requests).toHaveLength(0);
  });

  it('rejects empty updates, unsupported state flags, and extra ids', async () => {
    const empty = await runCLI(['invoice', 'update', 'inv_mutation'], baseUrl);
    expect(empty.status).not.toBe(0);
    expect(empty.output).toMatch(/at least one editable field/i);

    const status = await runCLI(
      ['invoice', 'update', 'inv_mutation', '--status', 'paid'],
      baseUrl
    );
    expect(status.status).not.toBe(0);
    expect(status.output).toContain('Unsupported option: --status');

    const extra = await runCLI(
      ['invoice', 'update', 'inv_mutation', 'inv_other', '--notes', 'x'],
      baseUrl
    );
    expect(extra.status).not.toBe(0);
    expect(extra.output).toContain('coinpay invoice update <id>');
    expect(requests).toHaveLength(0);
  });

  it.each([
    [['--amount', '0'], /amount.*positive/i],
    [['--currency', 'US'], /three-letter/i],
    [['--due-date', '2026-02-30'], /YYYY-MM-DD/i],
    [['--client-id='], /client-id.*empty/i],
  ])('validates update options before fetching the invoice', async (option, message) => {
    const result = await runCLI(
      ['invoice', 'update', 'inv_mutation', ...option],
      baseUrl
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(message);
    expect(requests).toHaveLength(0);
  });

  it('blocks non-draft updates before PUT', async () => {
    respond = () => ({
      body: { success: true, invoice: invoiceFixture({ status: 'sent' }) },
    });

    const result = await runCLI(
      ['invoice', 'update', 'inv_mutation', '--notes', 'new'],
      baseUrl
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/only draft invoices/i);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
  });

  it('fails when the API returns success without applying an update', async () => {
    respond = () => ({ body: { success: true, invoice: invoiceFixture() } });

    const result = await runCLI(
      ['invoice', 'update', 'inv_mutation', '--notes', 'Not applied'],
      baseUrl
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/update was not confirmed.*notes/i);
    expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT']);
  });

  it('publishes a draft with --yes and returns a live share link without email', async () => {
    respond = (request) =>
      request.method === 'GET'
        ? { body: { success: true, invoice: invoiceFixture() } }
        : {
            body: {
              success: true,
              invoice: invoiceFixture({
                status: 'sent',
                payment_address: '0xpay',
                user_id: 'private-user',
                clients: { email: 'private@example.com' },
              }),
              paymentLink: new URL('/now/inv_mutation', baseUrl).toString(),
              emailAttempted: false,
              idempotentReplay: false,
            },
          };

    const result = await runCLI(['invoice', 'publish', 'inv_mutation', '--yes', '--json'], baseUrl);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: 'inv_mutation',
      status: 'sent',
      paymentAddress: '0xpay',
      shareUrl: new URL('/now/inv_mutation', baseUrl).toString(),
      emailAttempted: false,
      idempotentReplay: false,
    });
    expect(result.stdout).not.toContain('private-user');
    expect(result.stdout).not.toContain('private@example.com');
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: '/api/invoices/inv_mutation' },
      { method: 'POST', url: '/api/invoices/inv_mutation/publish' },
    ]);
  });

  it('returns an already-published invoice without another mutation request', async () => {
    respond = () => ({
      body: {
        success: true,
        invoice: invoiceFixture({ status: 'sent', payment_address: '0xexisting' }),
      },
    });

    const result = await runCLI(['invoice', 'publish', 'inv_mutation', '--json', '--yes'], baseUrl);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'sent',
      paymentAddress: '0xexisting',
      emailAttempted: false,
      idempotentReplay: true,
    });
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('requires confirmation and valid draft payment routing before publish', async () => {
    respond = () => ({ body: { success: true, invoice: invoiceFixture() } });

    const noConfirmation = await runCLI(['invoice', 'publish', 'inv_mutation'], baseUrl);
    expect(noConfirmation.status).not.toBe(0);
    expect(noConfirmation.output).toMatch(/interactive terminal.*--yes/i);
    expect(requests.map((request) => request.method)).toEqual(['GET']);

    requests = [];
    respond = () => ({
      body: {
        success: true,
        invoice: invoiceFixture({ crypto_currency: null }),
      },
    });
    const missingCrypto = await runCLI(['invoice', 'publish', 'inv_mutation', '--yes'], baseUrl);
    expect(missingCrypto.status).not.toBe(0);
    expect(missingCrypto.output).toMatch(/crypto-currency before publishing/i);
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('sends a draft with --yes, sanitizes JSON, and returns the share link', async () => {
    respond = (request) => {
      if (request.method === 'GET') {
        return { body: { success: true, invoice: invoiceFixture() } };
      }
      return {
        body: {
          success: true,
          invoice: invoiceFixture({
            status: 'sent',
            sent_at: '2026-08-17T01:00:00.000Z',
            payment_address: '0xpay',
            user_id: 'private-user',
            manual_methods: { venmo: '@private' },
            clients: { email: 'client@example.com' },
          }),
        },
      };
    };

    const result = await runCLI(
      ['invoice', 'send', '--yes', 'inv_mutation', '--json'],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      id: 'inv_mutation',
      status: 'sent',
      paymentAddress: '0xpay',
      shareUrl: new URL('/now/inv_mutation', baseUrl).toString(),
    });
    expect(output).not.toHaveProperty('success');
    expect(output).not.toHaveProperty('user_id');
    expect(output).not.toHaveProperty('manual_methods');
    expect(output).not.toHaveProperty('clients');
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: '/api/invoices/inv_mutation' },
      { method: 'POST', url: '/api/invoices/inv_mutation/send' },
    ]);
    expect(requests.some((request) => request.url.includes('/chat'))).toBe(false);
  });

  it('accepts the legacy successful send response without risking a second send', async () => {
    respond = (request) => request.method === 'GET'
      ? { body: { success: true, invoice: invoiceFixture() } }
      : {
          body: {
            success: true,
            payment_address: '0xlegacy',
            stripe_checkout_url: 'https://checkout.example/session',
            clients: { email: 'client@example.com' },
          },
        };

    const result = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--yes', '--json'],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: 'inv_mutation',
      status: 'sent',
      paymentAddress: '0xlegacy',
      shareUrl: new URL('/now/inv_mutation', baseUrl).toString(),
    });
    expect(result.stdout).not.toContain('client@example.com');
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
  });

  it('does not treat an inconsistent wrapped send response as success', async () => {
    respond = () => ({
      body: {
        success: true,
        invoice: invoiceFixture({ status: 'draft' }),
      },
    });

    const result = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--yes'],
      baseUrl
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/send was not confirmed/i);
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
  });

  it('allows sending an overdue invoice', async () => {
    respond = (request) => ({
      body: {
        success: true,
        invoice: invoiceFixture({ status: request.method === 'POST' ? 'sent' : 'overdue' }),
      },
    });

    const result = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--yes'],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain('Invoice sent; email status was not reported by the server');
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
  });

  it('warns when payment details are created but the email provider rejects the message', async () => {
    respond = (request) => ({
      body: {
        success: true,
        emailAccepted: false,
        warning: 'The payment link is active, but the provider rejected the email.',
        invoice: invoiceFixture({ status: request.method === 'POST' ? 'sent' : 'draft' }),
      },
    });

    const result = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--yes'],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain('email provider did not accept the message');
    expect(result.output).not.toContain('client notified');
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
  });

  it('reports email rejection in JSON without exposing private invoice fields', async () => {
    respond = (request) => ({
      body: {
        success: true,
        emailAccepted: false,
        emailTrackingSaved: true,
        warning: 'The payment link is active, but the provider rejected the email.',
        emailError: 'Recipient suppressed',
        invoice: invoiceFixture({
          status: request.method === 'POST' ? 'sent' : 'draft',
          clients: { email: 'private@example.com' },
        }),
      },
    });

    const result = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--yes', '--json'],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'sent',
      emailAccepted: false,
      emailTrackingSaved: true,
      warning: 'The payment link is active, but the provider rejected the email.',
      emailError: 'Recipient suppressed',
    });
    expect(result.stdout).not.toContain('private@example.com');
  });

  it('requires --yes for non-interactive send and JSON send', async () => {
    respond = () => ({ body: { success: true, invoice: invoiceFixture() } });

    const nonInteractive = await runCLI(['invoice', 'send', 'inv_mutation'], baseUrl);
    expect(nonInteractive.status).not.toBe(0);
    expect(nonInteractive.output).toMatch(/interactive terminal.*--yes/i);
    expect(requests.map((request) => request.method)).toEqual(['GET']);

    requests = [];
    const json = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--json'],
      baseUrl
    );
    expect(json.status).not.toBe(0);
    expect(json.output).toMatch(/--json requires --yes/i);
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('blocks send for closed states and drafts without crypto', async () => {
    respond = () => ({
      body: { success: true, invoice: invoiceFixture({ status: 'paid' }) },
    });
    const closed = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--yes'],
      baseUrl
    );
    expect(closed.status).not.toBe(0);
    expect(closed.output).toMatch(/draft or overdue/i);
    expect(requests).toHaveLength(1);

    requests = [];
    respond = () => ({
      body: {
        success: true,
        invoice: invoiceFixture({ crypto_currency: null }),
      },
    });
    const missingCrypto = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--yes'],
      baseUrl
    );
    expect(missingCrypto.status).not.toBe(0);
    expect(missingCrypto.output).toMatch(/crypto-currency before sending/i);
    expect(requests).toHaveLength(1);
  });

  it('deletes a draft with --yes and emits a deterministic JSON result', async () => {
    respond = (request) => request.method === 'DELETE'
      ? { body: { success: true } }
      : { body: { success: true, invoice: invoiceFixture() } };

    const result = await runCLI(
      ['invoice', 'delete', '--yes', 'inv_mutation', '--json'],
      baseUrl
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ id: 'inv_mutation', deleted: true });
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: '/api/invoices/inv_mutation' },
      { method: 'DELETE', url: '/api/invoices/inv_mutation' },
    ]);
  });

  it('blocks delete without confirmation or for a non-draft invoice', async () => {
    respond = () => ({ body: { success: true, invoice: invoiceFixture() } });
    const confirmation = await runCLI(['invoice', 'delete', 'inv_mutation'], baseUrl);
    expect(confirmation.status).not.toBe(0);
    expect(confirmation.output).toMatch(/interactive terminal.*--yes/i);
    expect(requests.map((request) => request.method)).toEqual(['GET']);

    requests = [];
    respond = () => ({
      body: { success: true, invoice: invoiceFixture({ status: 'sent' }) },
    });
    const state = await runCLI(
      ['invoice', 'delete', 'inv_mutation', '--yes'],
      baseUrl
    );
    expect(state.status).not.toBe(0);
    expect(state.output).toMatch(/only draft invoices/i);
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('encodes ids for preflight and mutation requests', async () => {
    const id = 'inv#1/../payments';
    respond = (request) => request.method === 'DELETE'
      ? { body: { success: true } }
      : { body: { success: true, invoice: invoiceFixture({ id }) } };

    const result = await runCLI(['invoice', 'delete', id, '--yes'], baseUrl);

    expect(result.status).toBe(0);
    expect(requests.map((request) => request.url)).toEqual([
      '/api/invoices/inv%231%2F..%2Fpayments',
      '/api/invoices/inv%231%2F..%2Fpayments',
    ]);
  });

  it('rejects values for boolean flags instead of swallowing invoice ids', async () => {
    const yes = await runCLI(
      ['invoice', 'delete', 'inv_mutation', '--yes=false'],
      baseUrl
    );
    expect(yes.status).not.toBe(0);
    expect(yes.output).toContain('--yes does not take a value');

    const json = await runCLI(
      ['invoice', 'get', '--json=false', 'inv_mutation'],
      baseUrl
    );
    expect(json.status).not.toBe(0);
    expect(json.output).toContain('--json does not take a value');
    expect(requests).toHaveLength(0);
  });

  it('surfaces mutation API error codes without leaking the API key', async () => {
    respond = (request) => request.method === 'GET'
      ? { body: { success: true, invoice: invoiceFixture() } }
      : {
          status: 422,
          body: { error: 'Payee is invalid', code: 'PAYEE_INVALID' },
        };

    const result = await runCLI(
      ['invoice', 'send', 'inv_mutation', '--yes'],
      baseUrl
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Payee is invalid (PAYEE_INVALID)');
    expect(result.output).not.toContain('cp_test_invoice_key');
  });

  it('returns a non-zero status and useful error for API failures', async () => {
    respond = () => ({ status: 422, body: { error: 'Invoice could not be created' } });

    const result = await runCLI(['invoice', 'create', '--amount', '25'], baseUrl);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invoice could not be created');
    expect(result.stderr).not.toContain('cp_test_invoice_key');
  });
});
