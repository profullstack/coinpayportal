import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/invoices/catalog';
import { loadPortal } from '@/lib/invoices/portal';

/**
 * GET /api/portal/[token]
 * Public: the token is the credential. Lists the client's issued invoices
 * (never drafts or cancelled ones) and what is still outstanding.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const portal = await loadPortal(serviceClient(), token);
  if (!portal) return NextResponse.json({ success: false, error: 'Portal not found' }, { status: 404 });
  return NextResponse.json(
    { success: true, ...portal },
    { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } }
  );
}
