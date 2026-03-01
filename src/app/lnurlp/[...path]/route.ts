import { NextRequest, NextResponse } from 'next/server';

const LNBITS_URL = process.env.LNBITS_URL || 'https://ln.coinpayportal.com';

async function proxy(request: NextRequest, method: 'GET' | 'POST', path: string[]) {
  const search = request.nextUrl.searchParams.toString();
  const qs = search ? `?${search}` : '';
  const target = `${LNBITS_URL}/lnurlp/${path.join('/')}${qs}`;

  try {
    const upstream = await fetch(target, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? await request.text() : undefined,
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('LNURLp proxy error:', error);
    return NextResponse.json(
      { status: 'ERROR', reason: 'Lightning callback service unavailable' },
      { status: 502 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, 'GET', path || []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, 'POST', path || []);
}
