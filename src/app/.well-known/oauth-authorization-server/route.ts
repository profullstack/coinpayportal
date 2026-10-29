/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * GET /.well-known/oauth-authorization-server
 */
import { NextResponse } from 'next/server';
import { authorizationServerMetadata } from '@/lib/oauth/metadata';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(authorizationServerMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  });
}
