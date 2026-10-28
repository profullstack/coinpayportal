import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { hashToken, isHashedToken } from '@/lib/crypto/token-hash';

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('outrank_integrations')
    .select('id, name, kind, access_token, created_at, last_used_at, request_count')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/integrations] supabase error', error);
    return NextResponse.json(
      {
        error: 'Failed to load integrations',
        detail: error.message,
        code: error.code,
        hint: error.hint,
      },
      { status: 500 },
    );
  }
  // Hashed tokens (Outrank) cannot be shown again; never send the hash out.
  const integrations = (data ?? []).map((row) =>
    isHashedToken(row.access_token) ? { ...row, access_token: null } : row,
  );
  return NextResponse.json({ integrations });
}

const ALLOWED_KINDS = ['outrank', 'crawlproof'] as const;
type Kind = (typeof ALLOWED_KINDS)[number];

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  let body: { name?: string; kind?: string };
  try {
    body = (await req.json()) as { name?: string; kind?: string };
  } catch {
    body = {};
  }
  const kind: Kind = (ALLOWED_KINDS as readonly string[]).includes(body.kind ?? '')
    ? (body.kind as Kind)
    : 'outrank';
  const defaultName = kind === 'crawlproof' ? 'Crawlproof' : 'Outrank';
  const name = (body.name || defaultName).trim().slice(0, 100);
  // Token prefix encodes the source so a leaked secret is identifiable
  // at a glance, and a Crawlproof bearer pasted into the Outrank flow
  // (or vice versa) is obviously wrong.
  const prefix = kind === 'crawlproof' ? 'cp_lx_' : 'otrk_';
  const accessToken = `${prefix}${randomBytes(32).toString('base64url')}`;

  // Outrank bearers are only verified, so only their hash is stored and the
  // token is returned once, here. A Crawlproof bearer doubles as the
  // Standard-Webhooks HMAC secret, so we must keep it to verify signatures.
  const stored = kind === 'outrank' ? hashToken(accessToken) : accessToken;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('outrank_integrations')
    .insert({ name, kind, access_token: stored, created_by: guard.id })
    .select('id, name, kind, created_at, last_used_at, request_count')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to create integration' }, { status: 500 });
  }
  return NextResponse.json({ integration: { ...data, access_token: accessToken } });
}
