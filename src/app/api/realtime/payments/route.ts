import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyToken, getUserIdFromToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { extractBearerToken } from '@/lib/auth/middleware';
import { isInternalApiKey } from '@/lib/auth/secret-compare';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getAccessibleBusinessRoles } from '@/lib/auth/authz';
import { createClient } from '@supabase/supabase-js';

// Store active connections for broadcasting
const connections = new Map<string, Set<ReadableStreamDefaultController>>();

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
    const payload = verifyToken(token, getJwtSecret());
    merchantId = payload.userId || payload.sub || '';
    if (!merchantId) {
      return new Response('Invalid token payload', { status: 401 });
    }
  } catch {
    return new Response('Invalid token', { status: 401 });
  }

  // A valid token proved who the caller is, not what they may subscribe to.
  // Connections are keyed by `businessId || merchantId`, so without this check
  // any authenticated merchant could name someone else's business and receive
  // their live payment stream.
  if (businessId) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const roles = await getAccessibleBusinessRoles(supabase, merchantId);
    if (!roles.has(businessId)) {
      return new Response('Forbidden', { status: 403 });
    }
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
function broadcastPaymentEvent(
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
 * Shape of a broadcastable payment event.
 *
 * The endpoint used to forward whatever `event` object it was handed straight
 * into every subscriber's stream. The dashboard renders these as real
 * payments, so an arbitrary object was an arbitrary fake payment on a
 * merchant's screen. Only known event types with a well-formed payment body
 * are broadcast, and unknown fields are dropped rather than passed through.
 */
const paymentEventSchema = z.object({
  type: z.enum(['payment_created', 'payment_updated', 'payment_completed', 'payment_expired']),
  payment: z.object({
    id: z.string().uuid(),
    status: z.string().max(32),
    amount_crypto: z.string().max(64),
    amount_usd: z.string().max(64),
    currency: z.string().max(16),
    payment_address: z.string().max(128),
    confirmations: z.number().int().nonnegative().optional(),
    required_confirmations: z.number().int().nonnegative().optional(),
    tx_hash: z.string().max(128).optional(),
    created_at: z.string().max(64),
    updated_at: z.string().max(64),
  }),
});

const broadcastSchema = z.object({
  merchantId: z.string().uuid(),
  businessId: z.string().uuid().optional(),
  event: paymentEventSchema,
});

/**
 * POST endpoint to trigger payment events.
 *
 * Server-to-server only. This was unauthenticated, so anyone could push a
 * `payment_completed` event into any merchant's dashboard stream — the
 * merchant saw a payment that never happened, which is a usable setup for
 * "I paid, ship the goods". The internal key is now mandatory and compared in
 * constant time; an unset key authenticates nobody.
 */
export async function POST(request: NextRequest) {
  try {
    const token =
      extractBearerToken(request.headers.get('authorization')) ||
      request.headers.get('x-api-key')?.trim() ||
      null;

    if (!isInternalApiKey(token)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = broadcastSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message || 'Invalid event payload' },
        { status: 400 }
      );
    }

    const { merchantId, businessId, event } = parsed.data;

    // Second layer: a leaked internal key cannot be used to flood dashboards.
    const limit = await checkRateLimitAsync(businessId || merchantId, 'realtime_publish');
    if (!limit.allowed) {
      return Response.json({ error: 'Too many events' }, { status: 429 });
    }

    // Broadcast only the validated projection, never the raw request body.
    broadcastPaymentEvent(merchantId, businessId ?? null, event);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Failed to broadcast payment event:', error);
    return Response.json(
      { error: 'Failed to broadcast event' },
      { status: 500 }
    );
  }
}
