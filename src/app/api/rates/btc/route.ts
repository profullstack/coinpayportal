import { NextResponse } from 'next/server';
import { getExchangeRate } from '@/lib/rates/tatum';

export async function GET() {
  try {
    const price = await getExchangeRate('BTC', 'USD');
    return NextResponse.json({ price }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch {
    return NextResponse.json({ price: 0 }, { status: 500 });
  }
}
