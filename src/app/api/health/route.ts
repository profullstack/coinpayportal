import { NextResponse } from 'next/server';

export async function GET() {
  (globalThis as any).__posthogLogger?.emit({
    severityNumber: 9,
    severityText: 'INFO',
    body: 'Health check called',
    attributes: {
      route: '/api/health',
      service: 'coinpayportal',
    },
  });

  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || 'unknown',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
