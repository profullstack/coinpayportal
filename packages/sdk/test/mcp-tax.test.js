/** `coinpay mcp`: tax documents and tax sources. */

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleMessage } from '../src/mcp.js';

const ctx = (client) => ({ version: '9.9.9', home: mkdtempSync(join(tmpdir(), 'coinpay-mcp-')), log: () => {}, getClient: async () => client });
const call = (name, args, client) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx(client));

const docs = [
  { id: 'd1', title: 'Notice of Proposed Assessment', category: 'tax', taxYear: 2023, institutionKey: 'ftb', docType: 'notice' },
  { id: 'd2', title: 'Account Transcript', category: 'tax', taxYear: 2024, institutionKey: 'irs', docType: 'transcript' },
];

function client(paths) {
  return {
    async request(path) {
      paths.push(path);
      if (path.startsWith('/finances/documents/d2')) return { document: docs[1] };
      if (path.startsWith('/finances/documents')) return { documents: docs };
      if (path.startsWith('/finances/accounts')) return { accounts: [] };
      throw new Error(`unexpected ${path}`);
    },
  };
}

describe('tax tools', () => {
  it('lists tax documents, filtered by year and source', async () => {
    const paths = [];
    const res = await call('tax_documents_list', { taxYear: 2024 }, client(paths));
    expect(paths[0]).toBe('/finances/documents?category=tax');
    expect(JSON.parse(res.result.content[0].text).documents.map((d) => d.id)).toEqual(['d2']);
    const byFtb = await call('tax_documents_list', { source: 'ftb' }, client([]));
    expect(JSON.parse(byFtb.result.content[0].text).documents.map((d) => d.id)).toEqual(['d1']);
  });

  it('gets one document', async () => {
    const res = await call('tax_documents_get', { id: 'd2' }, client([]));
    expect(JSON.parse(res.result.content[0].text).document.title).toBe('Account Transcript');
  });

  it('statements_banks lists the tax sources with their throttle state', async () => {
    const res = await call('statements_banks', {}, client([]));
    const data = JSON.parse(res.result.content[0].text);
    expect(data.taxSources.map((s) => s.key)).toEqual(['ftb', 'irs', 'irs-business']);
    expect(data.taxSources[0].throttle).toEqual({ ok: true });
  });
});
