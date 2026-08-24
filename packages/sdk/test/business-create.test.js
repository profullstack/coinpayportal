import { describe, expect, it, vi } from 'vitest';
import { CoinPayClient } from '../src/client.js';

/**
 * Creating a business through the SDK.
 *
 * Both of these were live bugs, and together they made `coinpay business create`
 * unusable for automation: the command failed outright, and the obvious way to
 * work around it -- create without a webhook and patch it afterwards -- was needed
 * because the webhook URL was being dropped anyway.
 */

function clientCapturing() {
  const calls = [];
  const client = new CoinPayClient({ apiKey: 'cp_test_x', baseUrl: 'https://example.test' });
  client.request = vi.fn(async (path, opts) => {
    calls.push({ path, ...opts, parsed: opts.body ? JSON.parse(opts.body) : undefined });
    return { success: true };
  });
  return { client, calls };
}

describe('createBusiness', () => {
  /*
   * The API reads `input.webhook_url`. The SDK sent `webhookUrl`, which nothing
   * looks at -- so every business created this way came back with a null
   * webhook_url and no webhook secret, and the caller was told it succeeded.
   */
  it('sends the webhook url in the casing the API reads', async () => {
    const { client, calls } = clientCapturing();
    await client.createBusiness({
      name: 'example.com',
      category: 'media-publishing',
      webhookUrl: 'https://example.com/api/webhooks/coinpay',
    });
    expect(calls[0].parsed.webhook_url).toBe('https://example.com/api/webhooks/coinpay');
    expect(calls[0].parsed).not.toHaveProperty('webhookUrl');
  });

  /*
   * `category` is required by the API and was not sent at all, so every call
   * failed with "Select a valid business category" -- and the CLI had no flag to
   * supply one, so there was no way through it.
   */
  it('sends the category', async () => {
    const { client, calls } = clientCapturing();
    await client.createBusiness({ name: 'example.com', category: 'saas' });
    expect(calls[0].parsed.category).toBe('saas');
  });

  it('lets a caller supply its own webhook secret', async () => {
    const { client, calls } = clientCapturing();
    await client.createBusiness({
      name: 'example.com',
      category: 'saas',
      webhookSecret: 'whsec_mine',
    });
    expect(calls[0].parsed.webhook_secret).toBe('whsec_mine');
  });

  it('posts to /businesses', async () => {
    const { client, calls } = clientCapturing();
    await client.createBusiness({ name: 'x', category: 'saas' });
    expect(calls[0].path).toBe('/businesses');
    expect(calls[0].method).toBe('POST');
  });
});

describe('listBusinessCategories', () => {
  /* Fetched, never bundled: a stale copy is how the same error happens twice. */
  it('asks the server for the taxonomy', async () => {
    const { client, calls } = clientCapturing();
    await client.listBusinessCategories();
    expect(calls[0].path).toBe('/businesses/categories');
    expect(calls[0].method).toBe('GET');
  });
});
