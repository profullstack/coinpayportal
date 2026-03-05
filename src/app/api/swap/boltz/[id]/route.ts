/**
 * GET /api/swap/boltz/[id] - Check Boltz swap status
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSwapStatus } from '@/lib/swap/boltz';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const status = await getSwapStatus(id);
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get swap status' },
      { status: 500 },
    );
  }
}
