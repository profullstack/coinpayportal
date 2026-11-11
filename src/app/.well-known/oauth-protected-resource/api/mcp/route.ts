/** RFC 9728 path-suffixed form for the resource https://<host>/api/mcp. */
import { NextResponse } from 'next/server';
import { protectedResourceMetadata } from '@/lib/mcp/resource';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(protectedResourceMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  });
}
