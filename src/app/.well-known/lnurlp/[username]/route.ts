import { NextRequest, NextResponse } from 'next/server';

const LNBITS_URL = process.env.LNBITS_URL || 'https://ln.coinpayportal.com';

/**
 * Proxy /.well-known/lnurlp/<username> to LNbits
 * 
 * This is what makes user@coinpayportal.com Lightning Addresses work.
 * When a wallet looks up chovy@coinpayportal.com, it fetches:
 *   https://coinpayportal.com/.well-known/lnurlp/chovy
 * 
 * We proxy that to our LNbits instance which handles the LNURL-pay flow.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  
  // Forward query params (needed for LNURL-pay callback with amount)
  const searchParams = request.nextUrl.searchParams.toString();
  const queryString = searchParams ? `?${searchParams}` : '';
  
  try {
    const res = await fetch(
      `${LNBITS_URL}/.well-known/lnurlp/${username}${queryString}`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { status: 'ERROR', reason: `Unknown user: ${username}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    
    // Rewrite callback URL to go through our domain instead of ln.coinpayportal.com
    if (data.callback && data.callback.includes(LNBITS_URL)) {
      data.callback = data.callback.replace(
        LNBITS_URL,
        `https://${request.headers.get('host') || 'coinpayportal.com'}`
      );
    }

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('LNURL proxy error:', error);
    return NextResponse.json(
      { status: 'ERROR', reason: 'Lightning Address service unavailable' },
      { status: 502 }
    );
  }
}
