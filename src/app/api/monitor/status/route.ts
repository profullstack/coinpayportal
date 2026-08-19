import { NextRequest, NextResponse } from 'next/server';
import { isMonitorActive, runOnce, startMonitor, stopMonitor } from '@/lib/payments/monitor';
import { isInternalApiKey } from '@/lib/auth/secret-compare';

/**
 * GET /api/monitor/status
 * Check the status of the background payment monitor
 */
export async function GET(request: NextRequest) {
  // Verify authentication
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  
  // `token !== INTERNAL_API_KEY` compared two values that are BOTH `undefined`
  // when the env var is unset — and `undefined !== undefined` is false, so a
  // request with no Authorization header at all passed the check and could
  // start, stop or trigger the payment monitor. `isInternalApiKey` treats an
  // unset or blank secret as authenticating nobody, and compares in constant
  // time. It already existed; this route simply did not use it.
  if (!isInternalApiKey(token)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  return NextResponse.json({
    success: true,
    isRunning: isMonitorActive(),
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /api/monitor/status
 * Control the background payment monitor
 * 
 * Body:
 * - action: 'start' | 'stop' | 'run-once'
 */
export async function POST(request: NextRequest) {
  // Verify authentication
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  
  // `token !== INTERNAL_API_KEY` compared two values that are BOTH `undefined`
  // when the env var is unset — and `undefined !== undefined` is false, so a
  // request with no Authorization header at all passed the check and could
  // start, stop or trigger the payment monitor. `isInternalApiKey` treats an
  // unset or blank secret as authenticating nobody, and compares in constant
  // time. It already existed; this route simply did not use it.
  if (!isInternalApiKey(token)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  try {
    const body = await request.json();
    const { action } = body;
    
    switch (action) {
      case 'start':
        startMonitor();
        return NextResponse.json({
          success: true,
          message: 'Monitor started',
          isRunning: isMonitorActive(),
        });
        
      case 'stop':
        stopMonitor();
        return NextResponse.json({
          success: true,
          message: 'Monitor stopped',
          isRunning: isMonitorActive(),
        });
        
      case 'run-once':
        const stats = await runOnce();
        return NextResponse.json({
          success: true,
          message: 'Monitor cycle completed',
          stats,
          isRunning: isMonitorActive(),
        });
        
      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: start, stop, or run-once' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Monitor control error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to control monitor' },
      { status: 500 }
    );
  }
}