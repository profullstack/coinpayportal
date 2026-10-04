/**
 * POST /api/escrow — Create a new escrow
 * GET  /api/escrow — List escrows (requires auth)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isMultisigDefault, isMultisigEnabled } from '@/lib/multisig/engine';
import { createClient } from '@supabase/supabase-js';
import { createEscrow, listEscrows } from '@/lib/escrow';
import { authenticateRequest, isMerchantAuth, type AuthContext } from '@/lib/auth/middleware';
import { getAccessibleBusinessRoles } from '@/lib/auth/authz';
import { can } from '@/lib/auth/permissions';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { isBusinessPaidTier } from '@/lib/entitlements/service';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * POST /api/escrow
 * Create a new escrow — requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = await checkRateLimitAsync(clientIp, 'escrow_creation');
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 }
      );
    }

    // Authentication required for escrow creation — check before parsing body
    let isPaidTier = false;
    let businessId: string | undefined;

    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');

    if (!authHeader && !apiKeyHeader) {
      return NextResponse.json(
        { error: 'Authentication required. Provide Authorization header or X-API-Key.' },
        { status: 401 }
      );
    }

    let authContext: any;
    try {
      const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
      if (!authResult.success) {
        return NextResponse.json(
          { error: 'Invalid or expired authentication' },
          { status: 401 }
        );
      }
      authContext = authResult.context;
    } catch {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // This endpoint only creates custodial escrows. `escrow_model` used to be
    // accepted and then dropped by validation, so a caller asking for multisig
    // silently received a custodial escrow — the one failure mode that matters
    // most here, since it hands someone custody they explicitly declined.
    // Refuse instead, and point at the endpoint that can do it.
    if (body.escrow_model && body.escrow_model !== 'custodial') {
      if (body.escrow_model !== 'multisig_2of3') {
        return NextResponse.json(
          { error: `Unknown escrow_model: ${body.escrow_model}` },
          { status: 400 },
        );
      }
      return NextResponse.json(
        {
          error:
            'This endpoint creates custodial escrows only. Multisig escrows are created via ' +
            'POST /api/escrow/multisig, which requires depositor_pubkey, beneficiary_pubkey, and ' +
            'arbiter_pubkey. Check GET /api/escrow/model-availability first — multisig is behind ' +
            'a feature flag and is not always enabled.',
          code: 'MULTISIG_WRONG_ENDPOINT',
        },
        { status: 400 },
      );
    }

    // ESC-NEW-05: when the deployment advertises multisig as its default and
    // the caller omitted `escrow_model`, say what they are getting.
    //
    // `GET /api/escrow/model-availability` reports `multisig_default`, and only
    // the browser acted on it — the create page pre-selects multisig. An API
    // caller that omits the field gets a custodial escrow, meaning CoinPay
    // holds the funds, on a deployment that advertises the opposite. That is
    // the same silent-custody failure the explicit-request branch above was
    // fixed for, just reached by omission instead.
    //
    // Refusing would break every integration that has always omitted the
    // field, so the escrow is still created and the response says so.
    const multisigIsDefault = isMultisigEnabled() && isMultisigDefault();
    const defaultedToCustodial = multisigIsDefault && !body.escrow_model;

    if (defaultedToCustodial) {
      console.warn(
        '[Escrow] Created a custodial escrow while MULTISIG_DEFAULT is on — ' +
          'the caller omitted escrow_model. Pass it explicitly to remove the ambiguity.',
      );
    }

    // Resolve the owning business, and prove the caller owns it.
    //
    // `business_id` used to be taken from the body and trusted: the tier and
    // fee were evaluated against the *victim's* business, and the escrow showed
    // up in the victim's panel. Whichever credential was presented, the caller
    // must actually have access to the business they name.
    const requestedBusinessId: string | undefined =
      typeof body.business_id === 'string' ? body.business_id : undefined;

    if (isMerchantAuth(authContext)) {
      if (requestedBusinessId) {
        const roles = await getAccessibleBusinessRoles(supabase, authContext.merchantId);
        const role = roles.get(requestedBusinessId);
        if (!role || !can(role, 'escrow.write')) {
          return NextResponse.json(
            { error: 'No access to this business' },
            { status: 403 }
          );
        }
        businessId = requestedBusinessId;
        isPaidTier = await isBusinessPaidTier(supabase, businessId);
      }
    } else {
      // Business API key: it may only ever act for its own business. A body
      // that names a different one is rejected rather than quietly ignored.
      const keyBusinessId = (authContext as { businessId?: string }).businessId;
      if (requestedBusinessId && requestedBusinessId !== keyBusinessId) {
        return NextResponse.json(
          { error: 'API key does not belong to this business' },
          { status: 403 }
        );
      }
      if (keyBusinessId) {
        businessId = keyBusinessId;
        isPaidTier = await isBusinessPaidTier(supabase, businessId);
      }
    }

    // ── Normalize external integrations (e.g. ugig.net) ──
    // Accept `currency` as alias for `chain` (case-insensitive)
    const normalizedBody = { ...body };
    if (!normalizedBody.chain && normalizedBody.currency) {
      const currencyMap: Record<string, string> = {
        btc: 'BTC', eth: 'ETH', sol: 'SOL', pol: 'POL',
        usdc_pol: 'USDC_POL', usdc_sol: 'USDC_SOL', usdc_eth: 'USDC_ETH',
        usdt: 'USDT', bch: 'BCH', doge: 'DOGE', xrp: 'XRP',
        ada: 'ADA', bnb: 'BNB', usdc: 'USDC',
      };
      normalizedBody.chain = currencyMap[normalizedBody.currency.toLowerCase()] || normalizedBody.currency.toUpperCase();
      delete normalizedBody.currency;
    }

    // Accept `amount_usd` and convert to crypto amount via exchange rate
    if (!normalizedBody.amount && normalizedBody.amount_usd) {
      const { getExchangeRate } = await import('@/lib/rates/tatum');
      const chain = normalizedBody.chain;
      // Map chain to base currency for rate lookup
      const rateChain = chain?.replace(/^USDC_.*$/, 'USDC').replace(/^USDT$/, 'USDT');
      if (rateChain === 'USDC' || rateChain === 'USDT') {
        // Stablecoins: 1:1 with USD
        normalizedBody.amount = normalizedBody.amount_usd;
      } else {
        const rate = await getExchangeRate(rateChain, 'USD');
        if (rate && rate > 0) {
          normalizedBody.amount = normalizedBody.amount_usd / rate;
        } else {
          return NextResponse.json(
            { error: `Could not get exchange rate for ${chain}` },
            { status: 400 }
          );
        }
      }
      delete normalizedBody.amount_usd;
    }

    // When no wallet addresses provided but emails are, use placeholder addresses
    // The escrow service will generate a deposit address; beneficiary is paid out via email flow
    if (!normalizedBody.depositor_address && normalizedBody.depositor_email) {
      // Generate a placeholder — the actual deposit address is created by the escrow service
      normalizedBody.depositor_address = `pending:${normalizedBody.depositor_email}`;
    }
    if (!normalizedBody.beneficiary_address && normalizedBody.beneficiary_email) {
      normalizedBody.beneficiary_address = `pending:${normalizedBody.beneficiary_email}`;
    }

    const result = await createEscrow(supabase, {
      ...normalizedBody,
      business_id: businessId || normalizedBody.business_id,
    }, isPaidTier);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(
      defaultedToCustodial
        ? {
            ...result.escrow,
            // ESC-NEW-05: the deployment advertises multisig as its default and
            // this caller did not choose, so name the custody model rather than
            // leaving them to assume they got the advertised one.
            escrow_model: 'custodial',
            notice:
              'This deployment defaults to multisig, but escrow_model was not supplied and this ' +
              'endpoint creates custodial escrows only — CoinPay holds these funds. For a 2-of-3 ' +
              'escrow use POST /api/escrow/multisig.',
          }
        : result.escrow,
      { status: 201 },
    );
  } catch (error) {
    console.error('Failed to create escrow:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/escrow
 * List escrows — requires auth (merchant) or query by address
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);

    const filters: Record<string, string | number | undefined> = {
      status: searchParams.get('status') || undefined,
      depositor_address: searchParams.get('depositor') || undefined,
      beneficiary_address: searchParams.get('beneficiary') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    };

    // Authentication is mandatory.
    //
    // This endpoint used to accept `?depositor=` / `?beneficiary=` with no
    // credentials at all and return the matching escrows in full — third-party
    // emails, addresses, amounts and status — to anyone who could name or guess
    // a wallet address. Addresses are public by construction, so "knows the
    // address" was never an authorization signal.
    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');
    let merchantId: string | undefined;
    let businessIds: string[] | undefined;
    let scopedWalletAddresses: string[] = [];

    if (!authHeader && !apiKeyHeader) {
      return NextResponse.json(
        { error: 'Authentication required. Provide Authorization header or X-API-Key.' },
        { status: 401 }
      );
    }

    let listAuthContext: AuthContext | undefined;
    try {
      const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
      if (!authResult.success || !authResult.context) {
        return NextResponse.json(
          { error: 'Invalid or expired authentication' },
          { status: 401 }
        );
      }
      listAuthContext = authResult.context;
      if (isMerchantAuth(listAuthContext)) {
        merchantId = listAuthContext.merchantId;
        filters.business_id = searchParams.get('business_id') || undefined;
      } else {
        // Business API key — scope to that business, ignoring any body/query
        // attempt to name a different one.
        filters.business_id = listAuthContext.businessId;
      }
    } catch {
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    }

    // A merchant naming a business must actually have access to it.
    if (merchantId && filters.business_id) {
      const roles = await getAccessibleBusinessRoles(supabase, merchantId);
      if (!roles.has(String(filters.business_id))) {
        return NextResponse.json({ error: 'No access to this business' }, { status: 403 });
      }
    }

    const listRateCheck = await checkRateLimitAsync(
      merchantId || String(filters.business_id),
      'escrow_read'
    );
    if (!listRateCheck.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Scope to merchant's businesses if authenticated as merchant.
    // Resolved unconditionally (not just when business_id is absent) because
    // the depositor/beneficiary filters below are validated against this set.
    if (merchantId) {
      const { data: businesses } = await supabase
        .from('businesses')
        .select('id')
        .eq('merchant_id', merchantId);
      
      if (businesses && businesses.length > 0) {
        businessIds = businesses.map((b: { id: string }) => b.id);
      }

      // Also scope by wallets owned by this merchant (global + business wallets)
      const walletAddressSet = new Set<string>();

      const { data: merchantWallets } = await supabase
        .from('merchant_wallets')
        .select('wallet_address')
        .eq('merchant_id', merchantId)
        .eq('is_active', true);

      for (const row of merchantWallets || []) {
        if (row.wallet_address) walletAddressSet.add(row.wallet_address);
      }

      if (businessIds && businessIds.length > 0) {
        const { data: businessWallets } = await supabase
          .from('business_wallets')
          .select('wallet_address')
          .in('business_id', businessIds)
          .eq('is_active', true);

        for (const row of businessWallets || []) {
          if (row.wallet_address) walletAddressSet.add(row.wallet_address);
        }
      }

      scopedWalletAddresses = Array.from(walletAddressSet);
    }

    // An address filter must name an address the caller actually controls.
    //
    // Authentication alone is not enough here: without this, any merchant with
    // a valid token could pass someone else's public deposit address and read
    // that escrow's counterparty emails and amounts. For a business API key the
    // business_id scope already constrains the query, so the check applies to
    // merchant sessions.
    const addressFilters = [filters.depositor_address, filters.beneficiary_address].filter(
      (a): a is string => typeof a === 'string' && a.length > 0
    );
    if (addressFilters.length > 0 && merchantId) {
      const owned = new Set(scopedWalletAddresses);
      const foreign = addressFilters.filter((a) => !owned.has(a));
      if (foreign.length > 0) {
        return NextResponse.json(
          { error: 'Address filter must name a wallet on this account' },
          { status: 403 }
        );
      }
    }

    // Must have a scoping filter (status alone must NOT allow listing all escrows)
    const hasScope = Boolean(
      filters.depositor_address ||
      filters.beneficiary_address ||
      filters.business_id ||
      (businessIds && businessIds.length > 0) ||
      (scopedWalletAddresses && scopedWalletAddresses.length > 0)
    );
    if (!hasScope) {
      return NextResponse.json(
        { error: 'A scoping filter is required (depositor, beneficiary, business_id, or authenticated account scope)' },
        { status: 400 }
      );
    }

    const offset = Number(filters.offset || 0);
    const limit = Number(filters.limit || 20);

    // If the caller explicitly scopes by depositor/beneficiary/business_id, keep direct behavior.
    const hasExplicitPartyScope = Boolean(filters.depositor_address || filters.beneficiary_address || filters.business_id);
    if (hasExplicitPartyScope) {
      const result = await listEscrows(supabase, {
        ...filters,
        // Always constrained to the caller's own businesses.
        business_ids: filters.business_id ? undefined : businessIds,
      } as any);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({
        escrows: result.escrows,
        total: result.total,
        limit: filters.limit,
        offset: filters.offset,
      });
    }

    // Implicit authenticated account scope: union of business escrows + wallet-party escrows.
    const aggregate = new Map<string, any>();
    const queries: Array<Promise<{ success: boolean; escrows?: any[]; total?: number; error?: string }>> = [];

    if (businessIds && businessIds.length > 0) {
      queries.push(listEscrows(supabase, {
        ...filters,
        business_ids: businessIds,
        limit: 500,
        offset: 0,
      } as any));
    }

    if (scopedWalletAddresses.length > 0) {
      queries.push(listEscrows(supabase, {
        ...filters,
        depositor_addresses: scopedWalletAddresses,
        limit: 500,
        offset: 0,
      } as any));
      queries.push(listEscrows(supabase, {
        ...filters,
        beneficiary_addresses: scopedWalletAddresses,
        limit: 500,
        offset: 0,
      } as any));
    }

    const results = await Promise.all(queries);
    for (const result of results) {
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      for (const escrow of result.escrows || []) {
        aggregate.set(escrow.id, escrow);
      }
    }

    const mergedEscrows = Array.from(aggregate.values()).sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const pagedEscrows = mergedEscrows.slice(offset, offset + limit);

    return NextResponse.json({
      escrows: pagedEscrows,
      total: mergedEscrows.length,
      limit: filters.limit,
      offset: filters.offset,
    });
  } catch (error) {
    console.error('Failed to list escrows:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
