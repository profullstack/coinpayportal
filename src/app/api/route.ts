import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return NextResponse.json({
    name: 'CoinPayPortal API',
    version: '1.0',
    documentation: 'https://coinpayportal.com/docs',
    endpoints: {
      health: '/api/health',
      payments: '/api/payments',
      invoices: '/api/invoices',
      webhooks: '/api/webhooks',
      x402: '/api/x402',
    },
    timestamp: new Date().toISOString(),
  }, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
  });
}

export async function HEAD(request: NextRequest) {
  return new NextResponse(null, { status: 200 });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Allow': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    },
  });
}
