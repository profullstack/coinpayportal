import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant, keyMayActOnBusiness } from '@/lib/auth/merchant';
import { authorizeBusiness } from '@/lib/auth/authz';

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * POST /api/wallets/links/[id]/import
 *
 * Copy a linked web wallet's receive addresses into the account's global wallets
 * (or a business's wallets), so they show up everywhere the older wallet stores
 * are read — business settings, the payment-methods picker, exports.
 *
 * Linking alone already makes the wallet a payee source, so importing is a
 * convenience rather than a requirement. Existing entries for a coin are left
 * alone unless `overwrite` is set, so an import can never silently repoint a
 * wallet someone deliberately configured.
 *
 * Body: { target?: 'account' | 'business', business_id?, chains?: string[], overwrite?: boolean }
 */
export async function POST(
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

    const { data: link } = await supabase
      .from('wallet_account_links')
      .select('*')
      .eq('id', id)
      .eq('merchant_id', auth.merchantId)
      .maybeSingle();

    if (!link) {
      return NextResponse.json({ success: false, error: 'Wallet link not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const target: 'account' | 'business' = body.target === 'business' ? 'business' : 'account';
    const businessId = body.business_id || link.business_id;
    const overwrite = !!body.overwrite;
    const chainFilter: string[] | null = Array.isArray(body.chains) && body.chains.length > 0
      ? body.chains.map((c: string) => String(c).toUpperCase())
      : null;

    if (target === 'business') {
      if (!businessId) {
        return NextResponse.json(
          { success: false, error: 'business_id is required when target is "business"' },
          { status: 400 },
        );
      }

    // A key issued for one business must not act on another, even within the
    // same merchant account. `verifyBusinessAccess`/`authorizeBusiness` check
    // the MERCHANT's access, which a scoped key passes for every business its
    // owner has.
    if (!keyMayActOnBusiness(auth, businessId)) {
      return NextResponse.json(
        { success: false, error: 'This API key cannot act on that business' },
        { status: 403 }
      );
    }

      const authz = await authorizeBusiness(supabase, auth.merchantId, businessId, 'wallet.manage');
      if (!authz.ok) {
        return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
      }
    }

    const { data: addresses, error: addressError } = await supabase
      .from('wallet_addresses')
      .select('chain, address, derivation_index')
      .eq('wallet_id', link.wallet_id)
      .eq('is_active', true)
      .order('derivation_index', { ascending: true });

    if (addressError) {
      return NextResponse.json({ success: false, error: addressError.message }, { status: 400 });
    }

    // One receive address per chain — the lowest derivation index.
    const perChain = new Map<string, string>();
    for (const row of addresses ?? []) {
      const chain = String(row.chain).toUpperCase();
      if (chainFilter && !chainFilter.includes(chain)) continue;
      if (!perChain.has(chain)) perChain.set(chain, row.address);
    }

    if (perChain.size === 0) {
      return NextResponse.json(
        { success: false, error: 'This wallet has no active receive addresses to import' },
        { status: 400 },
      );
    }

    const table = target === 'business' ? 'business_wallets' : 'merchant_wallets';
    const scopeColumn = target === 'business' ? 'business_id' : 'merchant_id';
    const scopeValue = target === 'business' ? businessId : auth.merchantId;

    const { data: existing } = await supabase
      .from(table)
      .select('id, cryptocurrency')
      .eq(scopeColumn, scopeValue);

    const existingByCrypto = new Map<string, string>(
      (existing ?? []).map((row: { id: string; cryptocurrency: string }) => [
        row.cryptocurrency.toUpperCase(),
        row.id,
      ]),
    );

    const imported: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    const now = new Date().toISOString();

    for (const [chain, address] of perChain) {
      const existingId = existingByCrypto.get(chain);

      if (existingId && !overwrite) {
        skipped.push(chain);
        continue;
      }

      if (existingId) {
        const { error } = await supabase
          .from(table)
          .update({ wallet_address: address, is_active: true, updated_at: now })
          .eq('id', existingId);
        if (error) failed.push(chain);
        else updated.push(chain);
        continue;
      }

      const { error } = await supabase.from(table).insert({
        [scopeColumn]: scopeValue,
        cryptocurrency: chain,
        wallet_address: address,
        label: link.label || 'Web wallet',
        is_active: true,
      });
      if (error) failed.push(chain);
      else imported.push(chain);
    }

    return NextResponse.json({
      success: failed.length === 0,
      target,
      imported,
      updated,
      skipped,
      failed,
      // Spell out why a chain was skipped so the UI can offer the overwrite path
      // instead of looking like the import silently did nothing.
      message:
        skipped.length > 0 && !overwrite
          ? `Kept existing wallets for ${skipped.join(', ')}. Re-run with overwrite to replace them.`
          : undefined,
    });
  } catch (error) {
    console.error('Import linked wallet addresses error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
