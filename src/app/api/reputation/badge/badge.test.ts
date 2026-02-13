import { describe, it, expect, vi } from 'vitest';
import { GET } from './[did]/route';
import { NextRequest } from 'next/server';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

vi.mock('@/lib/reputation/attestation-engine', () => ({
  computeReputation: async () => ({
    agent_did: 'did:key:z6MkTest123',
    windows: {
      last_30_days: { task_count: 5, accepted_rate: 0.8, dispute_rate: 0.1 },
      last_90_days: { task_count: 15, accepted_rate: 0.9, dispute_rate: 0.05 },
      all_time: { task_count: 42, accepted_rate: 0.95, dispute_rate: 0.02 },
    },
    anti_gaming: { flagged: false, flags: [], adjusted_weight: 1 },
  }),
}));

describe('GET /api/reputation/badge/[did]', () => {
  it('returns SVG for valid DID', async () => {
    const req = new NextRequest('http://localhost/api/reputation/badge/did%3Akey%3Az6MkTest123');
    const res = await GET(req, { params: Promise.resolve({ did: 'did%3Akey%3Az6MkTest123' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    const svg = await res.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('95%');
    expect(svg).toContain('42 tasks');
  });

  it('returns SVG with "no data" for invalid DID', async () => {
    const req = new NextRequest('http://localhost/api/reputation/badge/invalid');
    const res = await GET(req, { params: Promise.resolve({ did: 'invalid' }) });
    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).toContain('no data');
  });
});
