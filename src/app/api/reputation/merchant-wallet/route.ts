/**
 * POST /api/reputation/merchant-wallet
 *
 * Platform endpoint for network apps (d0rz, c0mpute, etc.) to add or
 * update one of a user's payout/receive wallet addresses on CoinPay's
 * merchant_wallets table — the same store the /settings/wallets UI on
 * coinpayportal reads/writes. d0rz exposes a paste-form on its own
 * settings page; that form posts to its server, which forwards here with
 * the platform issuer key. Net effect: a wallet you add anywhere in the
 * network shows up everywhere.
 *
 * Auth: Bearer token matching a registered reputation_issuers API key.
 * Body: { merchant_id, cryptocurrency, wallet_address, label? }
 *
 * Upsert semantics: if a row already exists for (merchant_id,
 * cryptocurrency, wallet_address) we update the label / mark active.
 * Otherwise we insert a new row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

const walletSchema = z.object({
  merchant_id: z.string().uuid(),
  cryptocurrency: z.string().min(1).max(20),
  wallet_address: z.string().min(1).max(256),
  label: z.string().max(80).optional(),
});

async function authenticatePlatform(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest,
): Promise<{ did: string; name: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7);

  const { data } = await supabase
    .from('reputation_issuers')
    .select('did, name')
    .eq('api_key', apiKey)
    .eq('active', true)
    .single();

  return data;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const platform = await authenticatePlatform(supabase, request);
    if (!platform) {
      return NextResponse.json(
        { error: 'Invalid or missing API key' },
        { status: 401 },
      );
    }

    const body = await request.json();
    const parsed = walletSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    const { merchant_id, cryptocurrency, wallet_address, label } = parsed.data;

    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('id', merchant_id)
      .maybeSingle();
    if (!merchant) {
      return NextResponse.json({ error: 'merchant not found' }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from('merchant_wallets')
      .select('id')
      .eq('merchant_id', merchant_id)
      .eq('cryptocurrency', cryptocurrency)
      .eq('wallet_address', wallet_address)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from('merchant_wallets')
        .update({
          label: label ?? null,
          is_active: true,
        })
        .eq('id', existing.id);
      if (updateError) {
        console.error('[MerchantWallet] update error:', updateError);
        return NextResponse.json(
          { error: 'failed to update wallet' },
          { status: 500 },
        );
      }
      return NextResponse.json({
        merchant_id,
        cryptocurrency,
        wallet_address,
        action: 'updated',
      });
    }

    const { error: insertError } = await supabase
      .from('merchant_wallets')
      .insert({
        merchant_id,
        cryptocurrency,
        wallet_address,
        label: label ?? null,
        is_active: true,
      });
    if (insertError) {
      console.error('[MerchantWallet] insert error:', insertError);
      return NextResponse.json(
        { error: 'failed to add wallet' },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        merchant_id,
        cryptocurrency,
        wallet_address,
        action: 'inserted',
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[MerchantWallet] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
