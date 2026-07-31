import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Load a link and confirm it belongs to the caller. Returns 404 rather than 403
 * for someone else's link so link ids are not probeable.
 */
async function loadOwnLink(
  supabase: ReturnType<typeof client>,
  merchantId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from('wallet_account_links')
    .select('*')
    .eq('id', id)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * PATCH /api/wallets/links/[id]
 * Rename a linked wallet or make it the default payee source for its scope.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = client();
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const link = await loadOwnLink(supabase, auth.merchantId, id);
    if (!link) {
      return NextResponse.json({ success: false, error: 'Wallet link not found' }, { status: 404 });
    }

    const body = await request.json();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.label !== undefined) update.label = body.label || null;

    if (body.is_default === true) {
      // Only one default per scope, so stand down the current holder first.
      const clear = supabase
        .from('wallet_account_links')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('merchant_id', auth.merchantId)
        .neq('id', id);
      await (link.business_id
        ? clear.eq('business_id', link.business_id)
        : clear.is('business_id', null));
      update.is_default = true;
    } else if (body.is_default === false) {
      update.is_default = false;
    }

    const { data: updated, error } = await supabase
      .from('wallet_account_links')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to update wallet link' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, link: updated });
  } catch (error) {
    console.error('Update wallet link error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/wallets/links/[id]
 * Unlink a web wallet. The wallet itself and any addresses already imported into
 * business/global wallets are untouched — this only removes it as an automatic
 * payee source.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = client();
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const link = await loadOwnLink(supabase, auth.merchantId, id);
    if (!link) {
      return NextResponse.json({ success: false, error: 'Wallet link not found' }, { status: 404 });
    }

    const { error } = await supabase.from('wallet_account_links').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete wallet link error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
