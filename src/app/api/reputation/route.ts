import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    service: 'reputation',
    endpoints: [
      '/api/reputation/agent/:did/reputation',
      '/api/reputation/badge/:did',
      '/api/reputation/credential/:id',
      '/api/reputation/credentials',
      '/api/reputation/did/register',
      '/api/reputation/did/claim',
      '/api/reputation/did/me',
      '/api/reputation/issuers',
      '/api/reputation/receipt',
      '/api/reputation/receipts',
      '/api/reputation/verify',
      '/api/reputation/platform-action',
      '/api/reputation/revocation-list',
    ],
  });
}
