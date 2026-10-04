import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { subscribeLive, liveStatus, type LiveFrame, type LiveStatus } from '@/lib/finances/cloud-browser';
import { cloudError } from '@/lib/finances/cloud-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

/**
 * GET /api/finances/statements/cloud/live/:id/stream — Server-Sent Events:
 * `frame` events carry `{data: base64 JPEG, url, title}` of the cloud
 * browser's page, `status` events its lifecycle. At most ~8 frames a second
 * go out; a slow connection gets the newest frame, never a backlog.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    liveStatus(id, guard.id);
  } catch (err) {
    return cloudError(err, 'No such sign-in session');
  }

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => undefined;
  let timer: NodeJS.Timeout | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let pending: LiveFrame | null = null;
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (timer) clearInterval(timer);
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      timer = setInterval(() => {
        if (pending) {
          send('frame', { data: pending.data, url: pending.url, title: pending.title });
          pending = null;
        }
      }, 125);
      heartbeat = setInterval(() => send('ping', {}), 20_000);
      unsubscribe = subscribeLive(
        id,
        guard.id,
        (frame) => {
          pending = frame;
        },
        (status: LiveStatus) => {
          send('status', { status });
          if (['saved', 'cancelled', 'expired', 'failed'].includes(status)) setTimeout(close, 250);
        },
      );
      send('status', { status: liveStatus(id, guard.id).status });
      req.signal.addEventListener('abort', close);
    },
    cancel() {
      unsubscribe();
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
