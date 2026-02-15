import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPayLink, createUserWallet } from '@/lib/lightning/lnbits';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/lightning/address
 * Register a Lightning Address (username@coinpayportal.com)
 * 
 * Body: { wallet_id: string, username: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { wallet_id, username } = await request.json();

    if (!wallet_id || !username) {
      return NextResponse.json(
        { error: 'wallet_id and username are required' },
        { status: 400 }
      );
    }

    // Validate username format
    const usernameRegex = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { error: 'Username must be 3-32 chars, lowercase alphanumeric, dots, hyphens, underscores' },
        { status: 400 }
      );
    }

    // Check if username is already taken
    const { data: existing } = await supabase
      .from('wallets')
      .select('id')
      .eq('ln_username', username)
      .neq('id', wallet_id)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Username already taken' },
        { status: 409 }
      );
    }

    // Get wallet to check ownership
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, user_id, ln_username, ln_wallet_adminkey')
      .eq('id', wallet_id)
      .single();

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: 'Wallet not found' },
        { status: 404 }
      );
    }

    let adminKey = wallet.ln_wallet_adminkey;

    // Create LNbits wallet if user doesn't have one yet
    if (!adminKey) {
      const lnWallet = await createUserWallet(username);
      adminKey = lnWallet.adminkey;

      // Store LNbits wallet keys
      await supabase
        .from('wallets')
        .update({
          ln_wallet_adminkey: lnWallet.adminkey,
          ln_wallet_inkey: lnWallet.inkey,
          ln_wallet_id: lnWallet.id,
        })
        .eq('id', wallet_id);
    }

    // Create pay link in LNbits (this enables the Lightning Address)
    const payLink = await createPayLink(adminKey, {
      description: `Lightning Address for ${username}@coinpayportal.com`,
      min: 1,
      max: 1000000, // 1M sats max
      username,
    });

    // Save username to wallet
    const { error: updateError } = await supabase
      .from('wallets')
      .update({
        ln_username: username,
        ln_paylink_id: payLink.id,
      })
      .eq('id', wallet_id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to save username' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      lightning_address: `${username}@coinpayportal.com`,
      username,
    });
  } catch (error: unknown) {
    console.error('Lightning address error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/lightning/address?wallet_id=xxx
 * Get current Lightning Address for a wallet
 */
export async function GET(request: NextRequest) {
  const walletId = request.nextUrl.searchParams.get('wallet_id');
  
  if (!walletId) {
    return NextResponse.json(
      { error: 'wallet_id required' },
      { status: 400 }
    );
  }

  const { data: wallet } = await supabase
    .from('wallets')
    .select('ln_username')
    .eq('id', walletId)
    .single();

  if (!wallet?.ln_username) {
    return NextResponse.json({ lightning_address: null });
  }

  return NextResponse.json({
    lightning_address: `${wallet.ln_username}@coinpayportal.com`,
    username: wallet.ln_username,
  });
}
