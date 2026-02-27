import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPayLink, createUserWallet, getPayLink } from '@/lib/lightning/lnbits';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LIGHTNING_USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;
function isMissingLnbitsWalletError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /no wallet found|wallet not found|404/i.test(msg);
}

async function ensureLightningAddressBackend(walletId: string, username: string, wallet: {
  ln_wallet_adminkey?: string | null;
  ln_paylink_id?: number | null;
}) {
  let adminKey = wallet.ln_wallet_adminkey || null;

  const upsertLnbitsWallet = async () => {
    const lnWallet = await createUserWallet(username);
    adminKey = lnWallet.adminkey;

    await supabase
      .from('wallets')
      .update({
        ln_wallet_adminkey: lnWallet.adminkey,
        ln_wallet_inkey: lnWallet.inkey,
        ln_wallet_id: lnWallet.id,
      })
      .eq('id', walletId);
  };

  const createPayLinkForWallet = async () => createPayLink(adminKey!, {
    description: `Lightning Address for ${username}@coinpayportal.com`,
    min: 1,
    max: 1000000,
    username,
  });

  if (!adminKey) {
    await upsertLnbitsWallet();
  }

  try {
    if (wallet.ln_paylink_id && adminKey) {
      await getPayLink(adminKey, wallet.ln_paylink_id);
      return;
    }

    const payLink = await createPayLinkForWallet();
    await supabase
      .from('wallets')
      .update({ ln_paylink_id: payLink.id })
      .eq('id', walletId);
  } catch (error) {
    if (!isMissingLnbitsWalletError(error)) {
      throw error;
    }

    // Auto-heal stale LNbits linkage, then retry once.
    await upsertLnbitsWallet();
    const payLink = await createPayLinkForWallet();

    await supabase
      .from('wallets')
      .update({ ln_paylink_id: payLink.id })
      .eq('id', walletId);
  }
}

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
    if (!LIGHTNING_USERNAME_REGEX.test(username)) {
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
      .select('id, user_id, ln_username, ln_wallet_adminkey, ln_paylink_id')
      .eq('id', wallet_id)
      .single();

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: 'Wallet not found' },
        { status: 404 }
      );
    }

    await ensureLightningAddressBackend(wallet_id, username, {
      ln_wallet_adminkey: wallet.ln_wallet_adminkey,
      ln_paylink_id: wallet.ln_paylink_id,
    });

    // Save username to wallet
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ ln_username: username })
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
  const username = request.nextUrl.searchParams.get('username');
  if (username) {
    const normalized = username.trim().toLowerCase();

    if (!LIGHTNING_USERNAME_REGEX.test(normalized)) {
      return NextResponse.json({ available: false, reason: 'invalid_format' });
    }

    const { data: existing } = await supabase
      .from('wallets')
      .select('id')
      .eq('ln_username', normalized)
      .maybeSingle();

    return NextResponse.json({ available: !existing });
  }

  const walletId = request.nextUrl.searchParams.get('wallet_id');

  if (!walletId) {
    return NextResponse.json(
      { error: 'wallet_id required' },
      { status: 400 }
    );
  }

  const { data: wallet } = await supabase
    .from('wallets')
    .select('ln_username, ln_wallet_adminkey, ln_paylink_id')
    .eq('id', walletId)
    .single();

  if (!wallet?.ln_username) {
    return NextResponse.json({ lightning_address: null });
  }

  // Keep Lightning Address restorable after seed imports by self-healing
  // stale/missing LNbits wallet or paylink metadata in background.
  try {
    await ensureLightningAddressBackend(walletId, wallet.ln_username, {
      ln_wallet_adminkey: wallet.ln_wallet_adminkey,
      ln_paylink_id: wallet.ln_paylink_id,
    });
  } catch (error) {
    console.error('Lightning address backend self-heal failed:', error);
    // Do not block read response if backend repair fails.
  }

  return NextResponse.json({
    lightning_address: `${wallet.ln_username}@coinpayportal.com`,
    username: wallet.ln_username,
  });
}
