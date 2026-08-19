import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant, keyMayActOnBusiness } from '@/lib/auth/merchant';
import { authorizeBusiness } from '@/lib/auth/authz';
import { verifyAuthChallenge } from '@/lib/web-wallet/service';
import { listWalletAccountLinks } from '@/lib/wallets/linked-web-wallets';

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * GET /api/wallets/links
 * Web wallets associated with the caller's account, with the receive addresses
 * each one currently exposes.
 *
 * `?business_id=` narrows to links usable by that business (its own plus the
 * account-level ones).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = client();
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const businessId = new URL(request.url).searchParams.get('business_id');

    // A scoped key reads only its own business's links.
    if (!keyMayActOnBusiness(auth, businessId)) {
      return NextResponse.json(
        { success: false, error: 'This API key cannot read that business' },
        { status: 403 }
      );
    }

    const { links, error } = await listWalletAccountLinks(supabase, {
      merchantId: auth.merchantId,
      // With a scoped key and no explicit filter, narrow to the key's own
      // business rather than returning every business the merchant owns.
      businessId: businessId ?? auth.apiKeyBusinessId,
    });
    if (error) {
      return NextResponse.json({ success: false, error }, { status: 400 });
    }
    if (!links || links.length === 0) {
      return NextResponse.json({ success: true, links: [] });
    }

    const { data: addresses } = await supabase
      .from('wallet_addresses')
      .select('wallet_id, chain, address, derivation_index, is_active')
      .in('wallet_id', links.map((l) => l.wallet_id))
      .eq('is_active', true)
      .order('derivation_index', { ascending: true });

    const byWallet = new Map<string, { chain: string; address: string }[]>();
    for (const row of addresses ?? []) {
      const list = byWallet.get(row.wallet_id) ?? [];
      // One address per chain — the first derivation is the receive address.
      if (!list.some((a) => a.chain === row.chain)) {
        list.push({ chain: row.chain, address: row.address });
      }
      byWallet.set(row.wallet_id, list);
    }

    return NextResponse.json({
      success: true,
      links: links.map((link) => ({
        ...link,
        addresses: byWallet.get(link.wallet_id) ?? [],
      })),
    });
  } catch (error) {
    console.error('List wallet links error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/wallets/links
 * Associate a web wallet with this account (optionally scoped to one business).
 *
 * Ownership is proved the same way the wallet authenticates itself elsewhere: a
 * signed auth challenge. Without that anyone could claim any wallet id and start
 * receiving invoice payouts at an address they control — so the challenge is
 * mandatory, not a convenience.
 *
 * Body: { wallet_id, challenge_id, signature, business_id?, label?, is_default? }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = client();
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { wallet_id, challenge_id, signature, business_id, label, is_default } = body;

    if (!wallet_id || !challenge_id || !signature) {
      return NextResponse.json(
        {
          success: false,
          error: 'wallet_id, challenge_id and signature are required to prove wallet ownership',
        },
        { status: 400 },
      );
    }

    // Business-scoped links require write access to that business.
    if (business_id) {
    // A key issued for one business must not act on another, even when both
    // belong to the same merchant. `resolveMerchant` returns the key's own
    // business precisely so routes can enforce this; half of them did not.
      if (!keyMayActOnBusiness(auth, business_id)) {
        return NextResponse.json(
          { success: false, error: 'This API key cannot act on that business' },
          { status: 403 }
        );
      }

      const authz = await authorizeBusiness(supabase, auth.merchantId, business_id, 'wallet.manage');
      if (!authz.ok) {
        return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
      }
    }

    const proof = await verifyAuthChallenge(supabase, {
      wallet_id,
      challenge_id,
      signature,
      public_key_type: body.public_key_type,
    });

    if (!proof.success) {
      return NextResponse.json(
        { success: false, error: proof.error || 'Wallet ownership could not be verified', code: proof.code },
        { status: proof.code === 'INVALID_SIGNATURE' ? 401 : 400 },
      );
    }

    // Clear any existing default at the same scope before claiming it, since the
    // partial unique index allows only one.
    if (is_default) {
      const clear = supabase
        .from('wallet_account_links')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('merchant_id', auth.merchantId);
      await (business_id ? clear.eq('business_id', business_id) : clear.is('business_id', null));
    }

    // Deliberately not an upsert. Uniqueness here is enforced by PARTIAL indexes
    // (`WHERE business_id IS NULL` / `IS NOT NULL`), and Postgres will not match
    // `ON CONFLICT (cols)` to a partial index unless the predicate is restated —
    // which PostgREST's on_conflict cannot express. So resolve the existing row
    // by scope first, then update or insert.
    const scopeQuery = supabase
      .from('wallet_account_links')
      .select('id')
      .eq('wallet_id', wallet_id)
      .eq('merchant_id', auth.merchantId);

    const { data: existing } = await (business_id
      ? scopeQuery.eq('business_id', business_id)
      : scopeQuery.is('business_id', null)
    ).maybeSingle();

    const row = {
      wallet_id,
      merchant_id: auth.merchantId,
      business_id: business_id || null,
      label: label || null,
      is_default: !!is_default,
      updated_at: new Date().toISOString(),
    };

    const { data: link, error } = existing?.id
      ? await supabase
          .from('wallet_account_links')
          .update(row)
          .eq('id', existing.id)
          .select('*')
          .single()
      : await supabase
          .from('wallet_account_links')
          .insert(row)
          .select('*')
          .single();

    if (error || !link) {
      console.error('Link wallet error:', error);
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to link wallet' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, link }, { status: 201 });
  } catch (error) {
    console.error('Link wallet error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
