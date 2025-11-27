import { NextRequest } from 'next/server';
import { verifyToken, getUserIdFromToken } from '@/lib/auth/jwt';

// Store active connections for broadcasting
const connections = new Map<string, Set<ReadableStreamDefaultController>>();

// Get JWT secret from environment
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * Server-Sent Events endpoint for real-time payment updates
 *
 * GET /api/realtime/payments?businessId=xxx&token=xxx
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const businessId = searchParams.get('businessId');
  const token = searchParams.get('token');

  // Verify authentication
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  let merchantId: string;
  try {
    const payload = verifyToken(token, JWT_SECRET);
    merchantId = payload.userId || payload.sub || '';
    if (!merchantId) {
      return new Response('Invalid token payload', { status: 401 });
    }
  } catch {
    return new Response('Invalid token', { status: 401 });
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      // Add connection to tracking
      const connectionKey = businessId || merchantId;
      if (!connections.has(connectionKey)) {
        connections.set(connectionKey, new Set());
      }
      connections.get(connectionKey)!.add(controller);

      // Send initial connection message
      const connectMessage = JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString(),
      });
      controller.enqueue(`data: ${connectMessage}\n\n`);

      // Set up heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeat = JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          });
          controller.enqueue(`data: ${heartbeat}\n\n`);
        } catch {
          // Connection closed
          clearInterval(heartbeatInterval);
        }
      }, 30000); // Every 30 seconds

      // Clean up on close
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeatInterval);
        connections.get(connectionKey)?.delete(controller);
        if (connections.get(connectionKey)?.size === 0) {
          connections.delete(connectionKey);
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Broadcast a payment event to all connected clients
 * This function is called from other parts of the application when payment status changes
 */
export function broadcastPaymentEvent(
  merchantId: string,
  businessId: string | null,
  event: {
    type: 'payment_created' | 'payment_updated' | 'payment_completed' | 'payment_expired';
    payment: {
      id: string;
      status: string;
      amount_crypto: string;
      amount_usd: string;
      currency: string;
      payment_address: string;
      confirmations?: number;
      required_confirmations?: number;
      tx_hash?: string;
      created_at: string;
      updated_at: string;
    };
  }
) {
  const message = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  });

  // Broadcast to merchant's connections
  const merchantConnections = connections.get(merchantId);
  if (merchantConnections) {
    for (const controller of merchantConnections) {
      try {
        controller.enqueue(`data: ${message}\n\n`);
      } catch {
        // Connection closed, will be cleaned up
      }
    }
  }

  // Broadcast to business-specific connections
  if (businessId) {
    const businessConnections = connections.get(businessId);
    if (businessConnections) {
      for (const controller of businessConnections) {
        try {
          controller.enqueue(`data: ${message}\n\n`);
        } catch {
          // Connection closed, will be cleaned up
        }
      }
    }
  }
}

/**
 * POST endpoint to trigger payment events (for internal use or webhooks)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { merchantId, businessId, event } = body;

    // Validate required fields
    if (!merchantId || !event || !event.type || !event.payment) {
      return Response.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Broadcast the event
    broadcastPaymentEvent(merchantId, businessId, event);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Failed to broadcast payment event:', error);
    return Response.json(
      { error: 'Failed to broadcast event' },
      { status: 500 }
    );
  }
}