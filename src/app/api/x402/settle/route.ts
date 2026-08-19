/**
 * POST /api/x402/settle — Settle an x402 payment
 *
 * On this rail the buyer pays the merchant DIRECTLY. `payTo` in the 402
 * response is the merchant's own wallet (see `buildPaymentRequired` in
 * packages/sdk/src/x402.js), `/verify` records it as `to_address`, and this
 * route's job is to confirm on-chain that the address the proof named really
 * received the amount the proof promised.
 *
 * No CoinPayPortal wallet is in the path. This file used to claim otherwise —
 * "buyer pays the house wallet, we forward to the merchant minus commission" —
 * and carried three `TODO: forward from house wallet` markers plus helpers to
 * look up house mnemonics and fee wallets. None of it was ever wired up,
 * because there is nothing to forward: the money went straight to the
 * merchant. Implementing those TODOs literally would have paid every merchant
 * a second time out of our own float.
 *
 * The real consequence is that the platform fee is NOT collected on this rail.
 * `splitTieredPayment` below still computes it and the response still reports
 * it, which overstates what the platform received and understates what the
 * merchant did. Fixing that needs a product decision about how x402 fees are
 * charged; it is deliberately left visible rather than quietly dropped.
 *
 * Settlement checks by network:
 *   - EVM (ETH, POL, USDC): tx transferred >= amount to the payee
 *   - Bitcoin: outputs to the payee sum to >= amount
 *   - Bitcoin Cash: refused — no verified lookup wired up
 *   - Solana: payee's lamport or SPL balance rose by >= amount
 *   - Lightning: preimage proves payment (paid directly, nothing to check)
 *   - Stripe: capture the payment intent (Stripe handles splits)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { splitTieredPayment } from '@/lib/payments/fees';
import { resolveScopedKey } from '@/lib/auth/scoped-keys';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { addressesEqual } from '@/lib/x402/address';
import { isV2Payment } from '@/lib/x402/v2';
import { EVM_NETWORKS, checkSchemeForNetwork } from '@/lib/x402/networks';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/** RPC endpoints by network */
const RPC_URLS: Record<string, string> = {
  base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  ethereum: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
};



/** ERC-20 Transfer(address,address,uint256) topic. */
const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Verify an EVM transaction landed AND that it paid the expected recipient the
 * expected amount.
 *
 * Checking only `receipt.status === 1` established that *some* transaction
 * succeeded — nothing more. Any confirmed transaction hash on the chain
 * satisfied that, including a 1 wei transfer between two attacker addresses, so
 * a payment could be settled without the money ever having moved to the house
 * wallet.
 *
 * @param expectedTo  address the funds must have gone to
 * @param expectedAmount amount in the asset's smallest unit (wei / token units)
 * @param asset       ERC-20 contract address, or null/undefined for native
 */
async function verifyEvmTx(
  network: string,
  txHash: string,
  expectedTo: string,
  expectedAmount: bigint,
  asset?: string | null,
) {
  const rpcUrl = RPC_URLS[network];
  if (!rpcUrl) throw new Error(`No RPC configured for ${network}`);

  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const [receipt, tx] = await Promise.all([
    provider.getTransactionReceipt(txHash),
    provider.getTransaction(txHash),
  ]);

  if (!receipt || receipt.status !== 1) {
    throw new Error('Transaction not confirmed or failed');
  }
  if (!tx) {
    throw new Error('Transaction not found');
  }

  const wanted = expectedTo.toLowerCase();

  if (asset && asset !== ZERO_ADDRESS_X402) {
    // Token payment: the value is in a Transfer log emitted by the token
    // contract, not in tx.value.
    const transferred = receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === asset.toLowerCase() &&
          log.topics[0] === ERC20_TRANSFER_TOPIC &&
          log.topics.length >= 3 &&
          // topics[2] is the indexed `to`, left-padded to 32 bytes.
          `0x${log.topics[2].slice(26)}`.toLowerCase() === wanted,
      )
      .reduce((sum, log) => sum + BigInt(log.data === '0x' ? '0x0' : log.data), 0n);

    if (transferred < expectedAmount) {
      throw new Error(
        `Transaction did not transfer the expected amount to ${expectedTo} ` +
          `(got ${transferred}, expected ${expectedAmount})`,
      );
    }
  } else {
    if ((tx.to || '').toLowerCase() !== wanted) {
      throw new Error(`Transaction recipient is ${tx.to}, expected ${expectedTo}`);
    }
    if (tx.value < expectedAmount) {
      throw new Error(
        `Transaction paid ${tx.value}, expected at least ${expectedAmount}`,
      );
    }
  }

  return { confirmed: true, txHash };
}

/** Sentinel used by the x402 payloads for "native asset, not a token". */
const ZERO_ADDRESS_X402 = '0x0000000000000000000000000000000000000000';

/**
 * Verify a Bitcoin/BCH transaction.
 */
async function verifyUtxoTx(
  network: string,
  txId: string,
  expectedTo: string,
  expectedAmount: bigint,
) {
  if (network === 'bitcoin') {
    const res = await fetch(`https://mempool.space/api/tx/${txId}`);
    if (!res.ok) {
      throw new Error(`Could not look up transaction ${txId}`);
    }
    const tx = await res.json();

    // Sum the outputs paying the expected address. Previously only the
    // transaction's existence was checked, so any Bitcoin transaction settled
    // any x402 payment.
    // Compare under Bitcoin's casing rules. `expectedTo` used to arrive
    // lowercased, which no base58 or bech32 address ever matches, so this sum
    // was always 0 and every Bitcoin settlement failed as an underpayment.
    const paid = (tx.vout || [])
      .filter((out: { scriptpubkey_address?: string }) =>
        addressesEqual(network, out.scriptpubkey_address, expectedTo),
      )
      .reduce((sum: bigint, out: { value?: number }) => sum + BigInt(out.value ?? 0), 0n);

    if (paid < expectedAmount) {
      throw new Error(
        `Transaction paid ${paid} sats to ${expectedTo}, expected at least ${expectedAmount}`,
      );
    }

    return {
      confirmed: !!tx.status?.confirmed,
      txHash: txId,
      confirmations: tx.status?.block_height ? 1 : 0,
    };
  }

  // BCH has no verified lookup wired up here. Settling on an unverified txId
  // would credit a payment nobody has checked, so refuse instead.
  throw new Error(
    `${network} settlement is not supported: no way to verify the recipient and amount on-chain`,
  );
}

/**
 * Verify a Solana transaction.
 */
async function verifySolanaTx(
  txSignature: string,
  expectedTo: string,
  expectedAmount: bigint,
) {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [
        txSignature,
        { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
      ],
    }),
  });

  const data = await res.json();

  if (data.result?.meta?.err) {
    throw new Error(`Solana transaction failed: ${JSON.stringify(data.result.meta.err)}`);
  }
  if (!data.result) {
    return { confirmed: false, txHash: txSignature, pending: true };
  }

  // Confirm the expected recipient's balance actually increased by the expected
  // amount. A successful signature on its own proves nothing about who was
  // paid — any confirmed Solana transaction satisfied the old check.
  const accountKeys: Array<{ pubkey?: string } | string> =
    data.result.transaction?.message?.accountKeys ?? [];
  // Solana pubkeys are mixed-case base58. `expectedTo` used to arrive
  // lowercased, so the payee was never found among the account keys and every
  // Solana settlement failed with "Transaction does not involve".
  const index = accountKeys.findIndex((key) =>
    addressesEqual('solana', typeof key === 'string' ? key : key?.pubkey, expectedTo),
  );

  if (index === -1) {
    throw new Error(`Transaction does not involve ${expectedTo}`);
  }

  const pre = BigInt(data.result.meta?.preBalances?.[index] ?? 0);
  const post = BigInt(data.result.meta?.postBalances?.[index] ?? 0);
  const gained = post - pre;

  if (gained < expectedAmount) {
    // Fall back to token balances for SPL transfers, where the lamport
    // balances do not move.
    const tokenGain = solanaTokenGain(data.result.meta, expectedTo);
    if (tokenGain < expectedAmount) {
      throw new Error(
        `Transaction credited ${gained > 0n ? gained : tokenGain} to ${expectedTo}, ` +
          `expected at least ${expectedAmount}`,
      );
    }
  }

  return { confirmed: true, txHash: txSignature };
}

/** Net SPL token amount credited to `owner` by a parsed transaction's meta. */
function solanaTokenGain(meta: any, owner: string): bigint {
  // `owner` is compared under Solana's casing rules for the same reason the
  // lamport path is: a lowercased pubkey matches no token-balance owner, so
  // SPL gains were invisible and USDC settlement failed as an underpayment.
  const before = new Map<string, bigint>();
  for (const entry of meta?.preTokenBalances ?? []) {
    if (addressesEqual('solana', entry.owner, owner)) {
      before.set(String(entry.accountIndex), BigInt(entry.uiTokenAmount?.amount ?? '0'));
    }
  }

  let gain = 0n;
  for (const entry of meta?.postTokenBalances ?? []) {
    if (!addressesEqual('solana', entry.owner, owner)) continue;
    const post = BigInt(entry.uiTokenAmount?.amount ?? '0');
    gain += post - (before.get(String(entry.accountIndex)) ?? 0n);
  }
  return gain;
}

/**
 * Settle a Lightning payment — preimage already proves payment.
 */
async function settleLightning(
  payment: any,
  supabase: SupabaseClient,
  businessId: string,
  expectedAmount: bigint,
) {
  // This used to be a one-liner returning the payer's own `paymentHash` as the
  // settlement tx and `confirmed: true`. The route then answered
  // `settled: true` having confirmed nothing whatsoever — a consumer had no way
  // to tell a real settlement from this.
  //
  // Lightning genuinely is instant, so there is no broadcast to perform here.
  // What there is, is a fact to check: our node recorded an incoming settled
  // payment for this hash. Verification already checks it; re-checking at
  // settle keeps the two calls independently sound.
  const { paymentHash } = payment.payload;
  if (!paymentHash) throw new Error('Missing paymentHash for Lightning settlement');

  const { data: received, error } = await supabase
    .from('ln_payments')
    .select('payment_hash, business_id, direction, status, amount_msat')
    .eq('payment_hash', paymentHash)
    .maybeSingle();

  if (error) throw new Error('Could not read the Lightning ledger — refusing to report settlement');
  if (!received) throw new Error('No settled Lightning payment matches this payment hash');
  if (received.direction !== 'incoming' || received.status !== 'settled') {
    throw new Error(`Lightning payment is ${received.direction}/${received.status}, not a settled incoming payment`);
  }
  if (received.business_id && received.business_id !== businessId) {
    throw new Error('Lightning payment belongs to a different business');
  }
  if (BigInt(received.amount_msat) < expectedAmount) {
    throw new Error(
      `Underpayment: Lightning payment is ${received.amount_msat} msat, resource costs ${expectedAmount} msat`
    );
  }

  return { txHash: paymentHash, instant: true, confirmed: true };
}

/**
 * Settle a Stripe payment — capture the payment intent.
 */
async function settleStripe(payment: any) {
  const { paymentIntentId } = payment.payload;
  if (!paymentIntentId) throw new Error('Missing paymentIntentId');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error('Stripe not configured');

  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}` },
  });

  const pi = await res.json();
  if (pi.status === 'succeeded') {
    return { txHash: paymentIntentId, confirmed: true };
  }

  throw new Error(`Stripe capture failed: ${pi.status} — ${pi.last_payment_error?.message || ''}`);
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
    // `.eq('key_hash', apiKey)` comparing a RAW key against a hash column.
    // Real key material lives in `business_api_keys`, keyed by an HMAC of the
    // raw key; resolveScopedKey is the one place that knows how to check it.
    const resolved = await resolveScopedKey(supabase, apiKey);
    if (!resolved) {
      return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 });
    }
    const keyData = { id: resolved.keyId, business_id: resolved.business.id, active: true };

    // No rate limit or size cap on this route. An authenticated caller could
    // bloat the x402 ledger indefinitely, and on the Stripe rail each call
    // costs a request against our own Stripe API quota. Keyed by business so
    // one integrator cannot spend everyone else's headroom.
    const rate = await checkRateLimitAsync(keyData.business_id, 'x402_settle');
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { payment } = body;

    if (!payment?.payload) {
      return NextResponse.json({ error: 'Invalid payment data' }, { status: 400 });
    }

    // v2 proofs carry the network at the top level and the replay key inside
    // `authorization`, so the v1 accessors below find neither. Reading them
    // the v1 way would look up `unique_key IS NULL` on network `undefined` and
    // report the payment as never verified.
    const isV2 = isV2Payment(payment);

    const network: string = isV2 ? payment.network : payment.payload.network;
    const scheme: string = isV2 ? (payment.scheme ?? 'exact') : payment.payload.scheme;

    // Same consistency rule the verify route applies: `scheme` and `network`
    // are independent fields on the proof, so a scheme the named network does
    // not support means the proof is malformed, not that it should be routed
    // somewhere else.
    const schemeError = checkSchemeForNetwork(network, scheme);
    if (schemeError) {
      return NextResponse.json({ error: schemeError }, { status: 400 });
    }
    const uniqueKey = isV2
      ? payment.payload.authorization?.nonce
      : payment.payload.nonce ||
        payment.payload.txId ||
        payment.payload.txSignature ||
        payment.payload.preimage ||
        payment.payload.paymentIntentId;

    // Find the verified payment record
    const query = supabase
      .from('x402_payments')
      .select('*')
      .eq('network', network)
      .eq('business_id', keyData.business_id);

    if (uniqueKey) {
      query.eq('unique_key', uniqueKey);
    }

    const { data: verifiedPayment, error: vpError } = await query.single();

    if (vpError || !verifiedPayment) {
      return NextResponse.json(
        { error: 'Payment not found. Call /api/x402/verify first.' },
        { status: 400 }
      );
    }

    if (verifiedPayment.status === 'settled') {
      return NextResponse.json(
        { error: 'Payment already settled', txHash: verifiedPayment.tx_hash },
        { status: 409 }
      );
    }

    if (verifiedPayment.status !== 'verified') {
      return NextResponse.json(
        { error: `Cannot settle payment in status: ${verifiedPayment.status}` },
        { status: 400 }
      );
    }

    // Claim the payment before any on-chain verification or capture. The two
    // status checks above are reads; without this, concurrent settle calls both
    // pass them and both capture.
    const { data: settleClaim } = await supabase
      .from('x402_payments')
      .update({ status: 'settling', updated_at: new Date().toISOString() })
      .eq('id', verifiedPayment.id)
      .eq('status', 'verified')
      .select('id');

    if (!settleClaim || settleClaim.length === 0) {
      return NextResponse.json(
        { error: 'Payment is already being settled' },
        { status: 409 }
      );
    }

    /** Hand the claim back when settlement fails before anything was captured. */
    const releaseSettleClaim = async () => {
      await supabase
        .from('x402_payments')
        .update({ status: 'verified', updated_at: new Date().toISOString() })
        .eq('id', verifiedPayment.id)
        .eq('status', 'settling');
    };

    // The recipient and amount the proof was verified against. Settlement must
    // check the chain against THESE, not merely that some transaction exists.
    const expectedTo: string | null = verifiedPayment.to_address;
    const expectedAmount = (() => {
      try {
        return BigInt(verifiedPayment.amount);
      } catch {
        return null;
      }
    })();

    if (!expectedTo || expectedAmount === null || expectedAmount <= 0n) {
      await releaseSettleClaim();
      return NextResponse.json(
        {
          error:
            'Verified payment record is missing a recipient or a valid amount; refusing to settle.',
        },
        { status: 400 }
      );
    }

    // Check merchant tier for commission rate
    const isPaidTier = await isBusinessPaidTier(supabase, keyData.business_id);
    const { merchantAmount, platformFee, feePercentage } = splitTieredPayment(
      parseFloat(verifiedPayment.amount),
      isPaidTier
    );

    console.log(`[x402 Settle] Commission: ${feePercentage * 100}% (${isPaidTier ? 'paid' : 'free'} tier) — merchant gets ${merchantAmount}, platform keeps ${platformFee}`);

    // Route to the appropriate settlement method
    let result: { txHash: string; pending?: boolean; confirmed?: boolean; instant?: boolean; confirmations?: number };

    try {
      if (isV2) {
        // v2: nothing has been broadcast yet. Settling IS the broadcast — the
        // token verifies the payer's signature itself and moves the funds,
        // with our relayer paying the gas so the payer needs no native
        // currency. The asset comes from the ledger rather than the request,
        // so the caller cannot redirect settlement at a different token than
        // the one the proof was verified against.
        const authorization = payment.payload.authorization;
        const signature = payment.payload.signature;
        if (!authorization || !signature) {
          throw new Error('v2 settlement needs payload.authorization and payload.signature');
        }

        // Imported here rather than at module scope: this pulls in the gas
        // relayer and, through it, the system wallet, which drags ethers' `ws`
        // dependency into every consumer of this route.
        const { settleExactEvmV2 } = await import('@/lib/x402/settle-v2');

        const settled = await settleExactEvmV2({
          network,
          asset: verifiedPayment.asset,
          authorization,
          signature,
        });
        result = { txHash: settled.txHash, confirmed: true };
      } else if (network === 'lightning') {
        // Lightning: funds already arrived at the merchant's node. Confirm our
        // own ledger says so rather than taking the payer's word.
        //
        // Dispatch is on `network` alone. It used to also fire on
        // `scheme === 'bolt12'`, and scheme is an independent attacker-set
        // field, so a proof could name an EVM network and still take this
        // branch.
        result = await settleLightning(payment, supabase, keyData.business_id, expectedAmount);
      } else if (network === 'stripe') {
        // Stripe: capture payment intent, Stripe handles the split
        result = await settleStripe(payment);
      } else if (EVM_NETWORKS.has(network)) {
        // EVM: confirm the tx moved the amount to the merchant's own address.
        const txHash = payment.payload.txHash || payment.payload.txId;
        if (!txHash) throw new Error('Missing txHash for EVM settlement');
        result = await verifyEvmTx(
          network,
          txHash,
          expectedTo,
          expectedAmount,
          verifiedPayment.asset,
        );
      } else if (network === 'bitcoin' || network === 'bitcoin-cash') {
        // UTXO: confirm outputs to the merchant's own address cover the amount.
        const txId = payment.payload.txId;
        if (!txId) throw new Error('Missing txId for UTXO settlement');
        result = await verifyUtxoTx(network, txId, expectedTo, expectedAmount);
      } else if (network === 'solana') {
        // Solana: confirm the merchant's own balance rose by the amount.
        const txSig = payment.payload.txSignature;
        if (!txSig) throw new Error('Missing txSignature for Solana settlement');
        result = await verifySolanaTx(txSig, expectedTo, expectedAmount);
      } else {
        await releaseSettleClaim();
        return NextResponse.json(
          { error: `Unsupported network for settlement: ${network}` },
          { status: 400 }
        );
      }
    } catch (txError: any) {
      await supabase
        .from('x402_payments')
        .update({ status: 'settlement_failed', error: txError.message })
        .eq('id', verifiedPayment.id);

      return NextResponse.json(
        { error: 'Settlement failed', details: txError.message },
        { status: 500 }
      );
    }

    // Update payment record with commission info
    const finalStatus = result.pending ? 'pending_confirmation' : 'settled';
    await supabase
      .from('x402_payments')
      .update({
        status: finalStatus,
        tx_hash: result.txHash,
        settled_at: result.pending ? null : new Date().toISOString(),
      })
      .eq('id', verifiedPayment.id);

    return NextResponse.json({
      settled: !result.pending,
      status: finalStatus,
      txHash: result.txHash,
      network,
      asset: payment.payload.asset || payment.payload.extra?.assetSymbol,
      commission: {
        rate: `${feePercentage * 100}%`,
        tier: isPaidTier ? 'professional' : 'starter',
        merchantAmount: merchantAmount.toString(),
        platformFee: platformFee.toString(),
        // The buyer paid the merchant directly, so nothing was withheld: the
        // merchant received the full `amount`, not `merchantAmount`, and the
        // platform received nothing. These figures are what the tier WOULD
        // charge, not what changed hands. Reporting them without this flag
        // told merchants they had been charged a fee they had not paid.
        collected: false,
      },
    });
  } catch (error) {
    console.error('x402 settle error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
