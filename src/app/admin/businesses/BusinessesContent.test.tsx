// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BusinessesContent from './BusinessesContent';

const original = { id: 'biz-1', name: 'Test Shop', description: 'A shop', category: null, tags: ['old-tag'], risk_level: 'low', risk_flags: [], review_status: 'pending', active: true, created_at: '2026-10-30T00:00:00Z', merchant_id: 'merchant-1', owner_email: 'owner@example.com', webhook_url: null };
let business = { ...original };
let mutation: (body: Record<string, unknown>) => Promise<Response>;
const fetchMock = vi.fn();
const listCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/businesses?'));

beforeEach(() => {
  window.history.replaceState({}, '', '/admin/businesses');
  localStorage.clear();
  business = { ...original };
  mutation = async (body) => Response.json({ success: true, business: { ...business, ...body } });
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return mutation(JSON.parse(String(init.body)));
    if (url.startsWith('/api/admin/businesses?')) return Response.json({ businesses: [business], total: 1 });
    return Response.json({ business, linkedBusinesses: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open() {
  render(<BusinessesContent />);
  const name = await screen.findByText('Test Shop');
  const row = name.closest('tr')!;
  fireEvent.click(row);
  await screen.findByRole('button', { name: 'Approve' });
  return row;
}

describe('business review actions', () => {
  it.each([
    ['Approve', 'approved', { review_status: 'approved' }],
    ['Reject', 'rejected', { review_status: 'rejected' }],
    ['Deactivate', 'deactivated', { active: false }],
    ['Reactivate', 'reactivated', { active: true }],
  ])('%s confirms the result without remounting or refetching the list', async (button, verb, update) => {
    if (button === 'Reactivate') business.active = false;
    const row = await open();
    fireEvent.click(screen.getByRole('button', { name: button as string }));
    expect((await screen.findByRole('status')).textContent).toContain(`Test Shop: ${verb}.`);
    expect(screen.getByText('Test Shop').closest('tr')).toBe(row);
    expect(listCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1].body).toBe(JSON.stringify(update));
    expect(screen.getByRole('button', { name: 'Save tags' })).toBeTruthy();
    if ('review_status' in update) expect(within(row).getByText(update.review_status as string)).toBeTruthy();
    if ('active' in update) expect(screen.getByRole('button', { name: update.active ? 'Deactivate' : 'Reactivate' })).toBeTruthy();
  });

  it('shows pending state and prevents duplicate submissions', async () => {
    let resolve!: (r: Response) => void;
    mutation = () => new Promise((r) => { resolve = r; });
    await open();
    const approve = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(screen.getByRole('button', { name: 'Approving…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Reject' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Tags (comma separated)').hasAttribute('disabled')).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    resolve(Response.json({ success: true, business: { ...business, review_status: 'approved' } }));
    await screen.findByRole('status');
  });

  it('saves tags and displays the server classification in place', async () => {
    mutation = async () => Response.json({ success: true, business: { ...business, tags: ['new-tag'], risk_level: 'high' } });
    const row = await open();
    fireEvent.change(screen.getByLabelText('Tags (comma separated)'), { target: { value: ' New Tag ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    expect((await screen.findByRole('status')).textContent).toContain('tags saved');
    expect(within(row).getByText('high')).toBeTruthy();
    expect((screen.getByLabelText('Tags (comma separated)') as HTMLInputElement).value).toBe('new-tag');
    expect(listCalls()).toHaveLength(1);
  });

  it('removes an approved row from the pending filter with an explanation', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Review'), { target: { value: 'pending' } });
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await screen.findByText('Test Shop');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('status')).textContent).toContain('no longer matches the current filters');
    expect(screen.queryByText('Test Shop')).toBeNull();
    expect(listCalls()).toHaveLength(2);
    expect(screen.getByText('0 total across every merchant')).toBeTruthy();
  });

  it.each([401, 403, 404, 500])('reports HTTP %s and preserves the existing row for retry', async (status) => {
    mutation = async () => Response.json({ error: 'Server refused this update' }, { status });
    const row = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(status === 401 ? /session expired/ : status === 403 ? /Admin access/ : /Server refused/);
    expect(within(row).getByText('pending')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
    expect(listCalls()).toHaveLength(1);
  });

  it('reports network failures, lets the user retry, and dismisses stale messages', async () => {
    mutation = async () => { throw new TypeError('Failed to fetch'); };
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Check your connection');
    mutation = async () => Response.json({ success: true, business: { ...business, review_status: 'approved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByRole('status');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not announce success for an unverified response', async () => {
    mutation = async () => Response.json({ success: true, business: null });
    const row = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be verified');
    expect(within(row).getByText('pending')).toBeTruthy();
  });
});
