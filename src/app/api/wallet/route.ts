import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { error: 'Not found. See /api/web-wallet/* or /api/wallets/* for available wallet endpoints.' },
    { status: 404 }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: 'Not found. See /api/web-wallet/* or /api/wallets/* for available wallet endpoints.' },
    { status: 404 }
  );
}
