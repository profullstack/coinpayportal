import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth/admin-guard', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => db }));
vi.mock('@/lib/business/service', () => ({ mutateBusinessTags: vi.fn() }));
vi.mock('@/lib/fraud/linkage', () => ({ findLinkedBusinesses: vi.fn() }));
import { PATCH } from './route';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { mutateBusinessTags } from '@/lib/business/service';

let business: Record<string, unknown> | null;
let writeError: { message: string } | null;
let readError: { message: string } | null;
const writes = vi.fn();
const db = {
  from: vi.fn(() => {
    const query = {
      select: () => query,
      eq: () => query,
      update: (fields: Record<string, unknown>) => {
        writes(fields);
        if (!writeError && business) Object.assign(business, fields);
        return query;
      },
      maybeSingle: async () => ({ data: business, error: readError }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: writeError }).then(resolve),
    };
    return query;
  }),
};

function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/businesses/biz-1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ id: 'biz-1' }) };
beforeEach(() => {
  vi.clearAllMocks();
  business = { id: 'biz-1', name: 'Test Shop', review_status: 'pending', active: true, tags: [] };
  writeError = null;
  readError = null;
  vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', is_admin: true });
  vi.mocked(mutateBusinessTags).mockImplementation(async (_db, _id, _op, tags) => {
    Object.assign(business!, { tags, review_status: 'pending' });
    return { success: true, tags };
  });
});

describe('PATCH admin business actions', () => {
  it.each([{ review_status: 'approved' }, { review_status: 'rejected' }, { active: false }, { active: true }])('persists %j and returns the saved row', async (body) => {
    const response = await PATCH(request(body), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, business: { id: 'biz-1', ...body } });
    expect(writes).toHaveBeenCalledWith(body);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('preserves an explicit verdict after tags are reclassified', async () => {
    const response = await PATCH(request({ tags: ['reviewed'], review_status: 'approved' }), params);
    expect(await response.json()).toMatchObject({ business: { tags: ['reviewed'], review_status: 'approved' } });
  });

  it.each([{}, null, [], { active: 'false' }, { review_status: 'invalid' }, { tags: 'tag' }])('rejects invalid or empty updates: %j', async (body) => {
    expect((await PATCH(request(body), params)).status).toBe(400);
    expect(writes).not.toHaveBeenCalled();
  });

  it('reports a missing business instead of returning success with null', async () => {
    business = null;
    const response = await PATCH(request({ active: true }), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Business not found' });
  });

  it('reports write and verification errors', async () => {
    writeError = { message: 'Write refused' };
    const failed = await PATCH(request({ active: false }), params);
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ error: 'Write refused' });
    writeError = null;
    readError = { message: 'Read failed' };
    const unverified = await PATCH(request({ active: false }), params);
    expect(unverified.status).toBe(500);
    expect((await unverified.json()).success).toBeUndefined();
  });

  it('rejects unauthorized callers before accessing the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await PATCH(request({ active: false }), params)).status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });
});
