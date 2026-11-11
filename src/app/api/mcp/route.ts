/**
 * CoinPay remote MCP server: POST /api/mcp (stateless streamable HTTP, JSON).
 *
 * OAuth 2.1 protected resource: no token -> 401 with
 * `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`.
 * Tools act for the token's `sub`; see src/lib/mcp/.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateMcp } from '@/lib/mcp/auth';
import { mcpWwwAuthenticate } from '@/lib/mcp/resource';
import { handleMessage, type JsonRpcMessage, type JsonRpcResponse } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY = 1_000_000;

function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateMcp(request.headers.get('authorization'));
  if (!auth.ok) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: auth.description } },
      { status: auth.status, headers: { ...NO_STORE, 'WWW-Authenticate': mcpWwwAuthenticate(auth.error, auth.description) } }
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return rpcError(413, -32600, 'Request too large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(400, -32700, 'Parse error');
  }

  const ctx = { userId: auth.userId };
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return rpcError(400, -32600, 'Invalid Request');
    const replies = (await Promise.all(body.map((m) => handleMessage(m as JsonRpcMessage, ctx)))).filter(
      (r): r is JsonRpcResponse => r !== null
    );
    if (replies.length === 0) return new NextResponse(null, { status: 202, headers: NO_STORE });
    return NextResponse.json(replies, { headers: NO_STORE });
  }

  const reply = await handleMessage(body as JsonRpcMessage, ctx);
  if (!reply) return new NextResponse(null, { status: 202, headers: NO_STORE });
  return NextResponse.json(reply, { headers: NO_STORE });
}

/** No server-initiated stream: stateless server, JSON responses only. Unauthenticated still learns where to sign in. */
export async function GET(request: NextRequest) {
  const auth = await authenticateMcp(request.headers.get('authorization'));
  if (!auth.ok) {
    return new NextResponse(null, {
      status: auth.status,
      headers: { ...NO_STORE, 'WWW-Authenticate': mcpWwwAuthenticate(auth.error, auth.description) },
    });
  }
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST', ...NO_STORE } });
}

/** Stateless: there is no session to end. */
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST', ...NO_STORE } });
}
