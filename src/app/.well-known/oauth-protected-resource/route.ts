/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the remote MCP server.
 * GET /.well-known/oauth-protected-resource  (also served at .../api/mcp)
 */
import { NextResponse } from 'next/server';
import { protectedResourceMetadata } from '@/lib/mcp/resource';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(protectedResourceMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  });
}
