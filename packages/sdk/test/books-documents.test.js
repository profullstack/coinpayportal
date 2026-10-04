/**
 * `coinpay finances books export|send --with-documents`: the period's tax
 * documents ride along within 8 MiB. `send` has no default recipient.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFinancesCommand, EXIT } from '../src/finances-commands.js';

function fakeClient(routes) {
  const calls = [];
  return {
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      return routes[`${options.method || 'GET'} ${path.split('?')[0]}`](path, options);
    },
    async requestBinary(path) {
      calls.push({ path, binary: true });
      return routes[`BINARY ${path.split('?')[0]}`](path);
    },
  };
}

function ctxFor(client) {
  const out = [];
  const err = [];
  return { ctx: { client, out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe('books with tax documents', () => {
  it('export --with-documents asks for the ZIP and reports what was left out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-books-docs-'));
    const client = fakeClient({
      'BINARY /finances/books/export': async () => ({
        bytes: new Uint8Array([0x50, 0x4b, 5, 6]),
        filename: 'coinpay-cpa-pack-2025-01-01_2026-01-01-business.zip',
        headers: { 'x-unreviewed-rows': '0', 'x-documents-attached': '2', 'x-documents-skipped': '1' },
      }),
    });
    const { ctx, out } = ctxFor(client);
    const output = join(dir, 'pack.zip');
    expect(await runFinancesCommand('books', ['export'], { period: '2025', 'with-documents': true, output }, ctx)).toBe(EXIT.OK);
    expect(client.calls[0].path).toContain('with_documents=1');
    expect(out.join('\n')).toMatch(/2 tax document\(s\) inside, 1 left out to stay under 8 MiB/);
    expect(existsSync(output)).toBe(true);
  });

  it('export without the flag is unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-books-docs-'));
    const client = fakeClient({ 'BINARY /finances/books/export': async () => ({ bytes: new Uint8Array([1]), filename: 'b.csv', headers: {} }) });
    const { ctx } = ctxFor(client);
    expect(await runFinancesCommand('books', ['export'], { period: '2025', output: join(dir, 'b.csv') }, ctx)).toBe(EXIT.OK);
    expect(client.calls[0].path).not.toContain('with_documents');
  });

  it('send requires --to and passes withDocuments; there is no default recipient', async () => {
    const client = fakeClient({
      'POST /finances/books/send': async (_p, options) => {
        const body = JSON.parse(options.body);
        expect(body).toMatchObject({ to: ['you@example.com'], period: '2025', withDocuments: true });
        return {
          sent: ['you@example.com'], failed: [], attached: ['books.pdf', 'notice.pdf'], linkUrl: 'https://example.test/l', linkExpiresAt: '2026-11-01T00:00:00Z', rows: 3, unreviewed: 0,
          documents: { attached: ['notice.pdf'], skipped: [{ title: 'Big transcript', bytes: 9e6, reason: '8.6 MiB does not fit in the 8 MiB limit' }] },
        };
      },
    });
    const { ctx, out, err } = ctxFor(client);
    expect(await runFinancesCommand('books', ['send'], { period: '2025', 'with-documents': true }, ctx)).toBe(EXIT.INVALID);
    expect(err.join('\n')).toMatch(/--to/);
    expect(client.calls).toHaveLength(0);
    expect(await runFinancesCommand('books', ['send'], { to: 'you@example.com', period: '2025', 'with-documents': true }, ctx)).toBe(EXIT.OK);
    expect(out.join('\n')).toMatch(/Tax documents attached: notice\.pdf\. Not attached .*Big transcript/);
  });
});
