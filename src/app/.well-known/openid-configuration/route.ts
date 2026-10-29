/**
 * OIDC Discovery Document
 * GET /.well-known/openid-configuration
 */
import { NextResponse } from 'next/server';
import { authorizationServerMetadata } from '@/lib/oauth/metadata';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(authorizationServerMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  });
}
