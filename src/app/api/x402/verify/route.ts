/**
 * POST /api/x402/verify — Verify an x402 payment proof
 * 
 * CoinPayPortal's multi-chain, multi-asset x402 facilitator.
 * Validates payment proofs for:
 *   - EVM chains (ETH, POL, USDC on ETH/Polygon/Base) via EIP-712 signatures
 *   - Bitcoin/Bitcoin Cash via transaction proof
 *   - Solana (SOL, USDC) via transaction signature
 *   - Lightning via BOLT12 preimage
 *   - Stripe via payment intent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { resolveScopedKey } from '@/lib/auth/scoped-keys';
import { normalizeAddressForNetwork } from '@/lib/x402/address';
import { isV2Payment, verifyExactEvmV2, type V2Payment } from '@/lib/x402/v2';
import { createHash } from 'crypto';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/** Payment schemes and their verification strategies */
type PaymentScheme = 'exact' | 'bolt12' | 'stripe-checkout';

/** Chain IDs for EVM signature verification */
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  base: 8453,
};

/** EVM networks (use EIP-712 signature verification) */
const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'base']);

/** UTXO networks (use transaction proof verification) */
const UTXO_NETWORKS = new Set(['bitcoin', 'bitcoin-cash']);

/**
 * EIP-712 type for EVM payment signatures.
 *
 * `resource` binds the proof to the URL it buys. Without it a proof minted for
 * a $0.01 endpoint verifies just as happily against a $5.00 one, because the
 * signature says nothing about what was being purchased.
 */
const PAYMENT_TYPES = {
  Payment: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'asset', type: 'address' },
    { name: 'resource', type: 'string' },
  ],
};

/**
 * Domain version. Bumped to '2' with the addition of `resource`: a v1 proof
 * cannot satisfy the v2 struct, so old unbound proofs fail closed rather than
 * being reinterpreted under the new rules.
 */
const EIP712_DOMAIN_VERSION = '2';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Verify an EVM payment (ETH, POL, USDC on any EVM chain).
 */
async function verifyEvmPayment(payment: any) {
  const { signature, payload } = payment;
  const { from, to, amount, nonce, expiresAt, network, asset, resource } = payload;

  const chainId = CHAIN_IDS[network];
  if (!chainId) return { valid: false, error: `Unknown EVM network: ${network}` };

  // Check expiry
  if (expiresAt && expiresAt * 1000 < Date.now()) {
    return { valid: false, error: 'Payment proof has expired' };
  }

  // Verify EIP-712 typed data signature
  const domain = {
    name: 'x402',
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: asset || ZERO_ADDRESS,
  };

  const recoveredAddress = ethers.verifyTypedData(
    domain,
    PAYMENT_TYPES,
    {
      from,
      to,
      amount,
      nonce,
      expiresAt,
      asset: asset || ZERO_ADDRESS,
      resource: resource || '',
    },
    signature
  );

  if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
    return { valid: false, error: 'Invalid payment signature' };
  }

  return { valid: true };
}

/**
 * Verify a Bitcoin/Bitcoin Cash transaction proof.
 * The proof contains a txId that can be looked up on-chain.
 */
async function verifyUtxoPayment(payment: any) {
  const { payload } = payment;
  const { txId, to, amount, network } = payload;

  if (!txId) return { valid: false, error: 'Missing txId in UTXO payment proof' };

  // Use CoinPayPortal's existing payment monitoring infrastructure
  // to verify the transaction was broadcast and has the correct outputs.
  // For now, we accept the txId and verify asynchronously during settlement.
  // A production implementation would query a block explorer or full node.
  return { valid: true, pendingConfirmation: true };
}

/**
 * Verify a Solana transaction signature.
 */
async function verifySolanaPayment(payment: any) {
  const { payload } = payment;
  const { txSignature, from, to, amount } = payload;

  if (!txSignature) return { valid: false, error: 'Missing txSignature in Solana payment proof' };

  // Verify via Solana RPC — the signature is checked during settlement.
  // Accept optimistically for low-latency response; settle confirms finality.
  return { valid: true, pendingConfirmation: true };
}

/**
 * Verify a Lightning BOLT12 payment.
 */
async function verifyLightningPayment(payment: any) {
  const { payload } = payment;
  const { preimage, paymentHash } = payload;

  if (!preimage || !paymentHash) {
    return { valid: false, error: 'Missing preimage or paymentHash in Lightning proof' };
  }

  // Verify that SHA256(preimage) === paymentHash
  const crypto = await import('crypto');
  const computedHash = crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');

  if (computedHash !== paymentHash) {
    return { valid: false, error: 'Lightning preimage does not match payment hash' };
  }

  return { valid: true };
}

/**
 * Verify a Stripe payment intent.
 */
async function verifyStripePayment(payment: any) {
  const { payload } = payment;
  const { paymentIntentId } = payload;

  if (!paymentIntentId) {
    return { valid: false, error: 'Missing paymentIntentId in Stripe proof' };
  }

  // Verify via Stripe API
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return { valid: false, error: 'Stripe not configured' };

  try {
    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const pi = await res.json();

    if (pi.status === 'succeeded' || pi.status === 'requires_capture') {
      return { valid: true };
    }
    return { valid: false, error: `Stripe payment status: ${pi.status}` };
  } catch (err: any) {
    return { valid: false, error: `Stripe verification failed: ${err.message}` };
  }
}

/**
 * Networks whose proofs are authenticated by the payer's signature, so the
 * `amount` in the payload cannot be altered without invalidating the proof.
 *
 * For every other network the payload is self-reported until settlement
 * confirms it on-chain, which is why those verifications come back
 * `pendingConfirmation` and must not be treated as final.
 */
const SIGNATURE_BOUND_NETWORKS = EVM_NETWORKS;

/**
 * Enforce that the proof pays at least the asking price, for the resource it
 * was minted for.
 *
 * The merchant's middleware holds the API key, so what it says is owed is
 * authoritative. Previously nothing compared the two: any well-formed proof
 * unlocked any priced route.
 */
function enforcePriceBinding(payment: any, expected: any) {
  if (!expected || typeof expected !== 'object') {
    return {
      ok: false,
      error:
        'Missing `expected` — verification requires the asking price and resource. ' +
        'Upgrade to an SDK that sends them; see docs/X402_INTEGRATION.md.',
    };
  }

  const { amount: expectedAmount, resource: expectedResource } = expected;

  if (expectedAmount === undefined || expectedAmount === null || expectedAmount === '') {
    return { ok: false, error: 'Missing `expected.amount` — cannot verify the proof covers the price' };
  }
  if (!expectedResource) {
    return { ok: false, error: 'Missing `expected.resource` — cannot verify the proof buys this resource' };
  }

  // Compare in the asset's smallest unit. BigInt, not Number: wei overflows
  // float64 and silently compares equal well below the asking price.
  let paid: bigint;
  let owed: bigint;
  try {
    paid = BigInt(String(payment.payload.amount ?? ''));
    owed = BigInt(String(expectedAmount));
  } catch {
    return { ok: false, error: 'Invalid amount: expected an integer in the asset smallest unit' };
  }

  if (paid < owed) {
    return { ok: false, error: `Underpayment: proof pays ${paid}, resource costs ${owed}` };
  }

  const paidFor = payment.payload.resource;
  if (paidFor !== expectedResource) {
    return {
      ok: false,
      error: `Resource mismatch: proof was minted for ${paidFor || '(none)'}, not ${expectedResource}`,
    };
  }

  return { ok: true as const };
}


/**
 * Store an audit copy of a payment proof WITHOUT the signature.
 *
 * The full proof was previously stringified into `raw_proof` verbatim. That
 * column is write-only — nothing in the codebase reads it — so its entire
 * effect was to keep a durable copy of the payer's signed authorization. A
 * signature is a credential: if replay protection is ever bypassed, or the row
 * is read by something that should not have it, the stored proof is directly
 * reusable.
 *
 * What is worth keeping is the shape of the proof for forensics, so each
 * secret-bearing field is replaced by a hash of itself. Two reports of "the
 * same proof" can still be matched, and nothing reusable is retained.
 */
function redactProof(payment: any): string {
  const payload = { ...(payment?.payload ?? {}) };

  for (const field of ['signature', 'preimage', 'privateKey', 'secret']) {
    if (payload[field]) {
      payload[field] = `sha256:${createHash('sha256').update(String(payload[field])).digest('hex')}`;
    }
  }

  return JSON.stringify({ ...payment, payload, _redacted: true });
}

/**
 * Verify a v2 (EIP-3009) proof and record it.
 *
 * Kept separate from the v1 path rather than folded into it, because almost
 * nothing is shared: there is no transaction to look up, no `pendingConfirmation`
 * (the signature is final the moment it verifies), and the replay key is the
 * EIP-3009 nonce rather than a grab-bag of possible identifiers.
 */
async function verifyV2(
  _request: NextRequest,
  supabase: ReturnType<typeof getSupabase>,
  keyData: { business_id: string },
  payment: unknown,
  expected: {
    amount?: string;
    resource?: string;
    payTo?: string;
    asset?: string;
  } | undefined,
) {
  if (!expected || typeof expected !== 'object') {
    return NextResponse.json(
      { error: 'Missing `expected` — verification requires the asking price, payee and asset' },
      { status: 400 },
    );
  }
  // `payTo` and `asset` are needed here but not in v1: an EIP-3009 signature
  // says nothing about which token it is denominated in, so without the asset
  // there is no domain to verify it against, and without the payee there is
  // nothing to check `authorization.to` means the merchant.
  for (const field of ['amount', 'resource', 'payTo', 'asset'] as const) {
    if (!expected[field]) {
      return NextResponse.json(
        { error: `Missing \`expected.${field}\` — required to verify an x402 v2 proof` },
        { status: 400 },
      );
    }
  }

  const result = await verifyExactEvmV2(payment as V2Payment, {
    amount: expected.amount!,
    payTo: expected.payTo!,
    asset: expected.asset!,
  });

  if (!result.valid || !result.payment) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const verified = result.payment;

  const { error: insertError } = await supabase.from('x402_payments').insert({
    business_id: keyData.business_id,
    from_address: normalizeAddressForNetwork(verified.network, verified.from),
    to_address: normalizeAddressForNetwork(verified.network, verified.to),
    amount: verified.amount,
    unique_key: verified.uniqueKey,
    network: verified.network,
    scheme: 'exact',
    asset: verified.asset,
    resource: expected.resource,
    raw_proof: redactProof(payment),
    status: 'verified',
    // Nothing is pending: an EIP-3009 signature is complete on its own. What
    // has not happened yet is settlement, which is a separate call.
    pending_confirmation: false,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'Payment proof already used (replay detected)' },
        { status: 400 },
      );
    }
    console.error('x402 verify (v2): could not record payment', insertError);
    return NextResponse.json(
      { error: 'Could not record payment — verification refused' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    valid: true,
    x402Version: 2,
    payment: {
      from: verified.from,
      to: verified.to,
      amount: verified.amount,
      asset: verified.asset,
      network: verified.network,
      resource: expected.resource,
      validBefore: verified.validBefore,
      pendingConfirmation: false,
      // The signature binds the amount, so it cannot be altered without
      // invalidating the proof.
      amountAuthenticated: true,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
    }

    const supabase = getSupabase();

    // Authenticate the API key.
    //
    // This used to query a table called `api_keys` that does not exist, with
    // `.eq('key_hash', apiKey)` comparing a RAW key against a hash column. The
    // query therefore always errored or returned nothing, and the route's
    // behaviour depended entirely on how that empty result was handled — which
    // is not authentication, it is an accident. Real key material lives in
    // `business_api_keys`, keyed by an HMAC of the raw key; `resolveScopedKey`
    // is the one place that knows how to check it.
    const resolved = await resolveScopedKey(supabase, apiKey);
    if (!resolved) {
      return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 });
    }
    const keyData = { id: resolved.keyId, business_id: resolved.business.id, active: true };

    const body = await request.json();
    const { payment, expected } = body;

    if (!payment || !payment.payload) {
      return NextResponse.json(
        { error: 'Invalid payment proof: missing payload' },
        { status: 400 }
      );
    }

    // v2 proofs are a different object entirely: an EIP-3009 authorization
    // that IS the payment, rather than a claim about a transaction. They carry
    // no `resource` field — EIP-3009 has nowhere to put one — so they cannot
    // go through `enforcePriceBinding`, which checks exactly that.
    if (isV2Payment(payment)) {
      return await verifyV2(request, supabase, keyData, payment, expected);
    }

    // What the merchant is charging, and for what. Checked before the proof is
    // trusted so an underpaying or misdirected proof never reaches the ledger.
    const binding = enforcePriceBinding(payment, expected);
    if (!binding.ok) {
      return NextResponse.json({ error: binding.error }, { status: 400 });
    }

    const { network, scheme } = payment.payload;
    const methodKey = payment.payload.methodKey || payment.payload.extra?.methodKey;

    // Route to the appropriate verifier based on network/scheme
    let result: { valid: boolean; error?: string; pendingConfirmation?: boolean };

    if (scheme === 'bolt12' || network === 'lightning') {
      result = await verifyLightningPayment(payment);
    } else if (scheme === 'stripe-checkout' || network === 'stripe') {
      result = await verifyStripePayment(payment);
    } else if (EVM_NETWORKS.has(network)) {
      result = await verifyEvmPayment(payment);
    } else if (UTXO_NETWORKS.has(network)) {
      result = await verifyUtxoPayment(payment);
    } else if (network === 'solana') {
      result = await verifySolanaPayment(payment);
    } else {
      return NextResponse.json(
        { error: `Unsupported network/scheme: ${network}/${scheme}` },
        { status: 400 }
      );
    }

    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Replay identity. Stripe proofs carry no nonce/txId/txSignature/preimage —
    // their unique identifier is the PaymentIntent id, so include it here.
    const uniqueKey =
      payment.payload.nonce ||
      payment.payload.txId ||
      payment.payload.txSignature ||
      payment.payload.preimage ||
      payment.payload.paymentIntentId;

    if (!uniqueKey) {
      return NextResponse.json(
        { error: 'Proof carries no nonce, txId, txSignature, preimage or paymentIntentId — cannot be replay-checked' },
        { status: 400 }
      );
    }

    // Record the verified payment. The unique index on (unique_key, network)
    // is what rejects replays: a read-then-write check lets two concurrent
    // verifies of the same proof both pass, and silently degrades to "allow"
    // if the table is unreachable. Let the INSERT decide.
    const { error: insertError } = await supabase.from('x402_payments').insert({
      business_id: keyData.business_id,
      // Per-network casing. Lowercasing unconditionally corrupted Bitcoin and
      // Solana addresses, so settlement could never match them on-chain.
      from_address: normalizeAddressForNetwork(network, payment.payload.from),
      to_address: normalizeAddressForNetwork(network, payment.payload.to),
      amount: payment.payload.amount,
      unique_key: uniqueKey,
      network,
      scheme: scheme || 'exact',
      asset: payment.payload.asset || payment.payload.extra?.assetSymbol || network,
      method_key: methodKey,
      resource: expected.resource,
      raw_proof: redactProof(payment),
      status: 'verified',
      pending_confirmation: result.pendingConfirmation || false,
    });

    if (insertError) {
      // 23505 = unique_violation: this proof has already been redeemed.
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'Payment proof already used (replay detected)' },
          { status: 400 }
        );
      }

      // Anything else (table missing, RLS, connectivity) must fail closed.
      // Reporting `valid: true` on an unrecorded payment is how a proof
      // becomes infinitely reusable.
      console.error('x402 verify: could not record payment', insertError);
      return NextResponse.json(
        { error: 'Could not record payment — verification refused' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      valid: true,
      payment: {
        from: payment.payload.from,
        to: payment.payload.to,
        amount: payment.payload.amount,
        resource: expected.resource,
        network,
        asset: payment.payload.asset || payment.payload.extra?.assetSymbol,
        method: methodKey,
        // True when the amount is self-reported and only settlement can confirm
        // it. Callers must not serve paid content on an unconfirmed proof
        // unless they have accepted that risk.
        pendingConfirmation: result.pendingConfirmation || false,
        amountAuthenticated: SIGNATURE_BOUND_NETWORKS.has(network),
      },
    });
  } catch (error) {
    console.error('x402 verify error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
