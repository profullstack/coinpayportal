/**
 * Recover a single stranded Solana payment address, sending 100% to the merchant.
 *
 * This is deliberately NOT forwardPaymentSecurely: that path always splits off
 * the platform commission. When funds were stranded by a platform defect rather
 * than by anything the merchant did, the whole balance goes back to them.
 *
 * Safety rails, in order of how badly each would hurt if skipped:
 *   - The destination is taken from ARGV, never from the database. A payout
 *     address that someone edited in the DB cannot silently redirect the sweep.
 *   - The keypair derived from the stored key must equal the address we are
 *     draining, or the run aborts. (SolanaProvider only *logs* this mismatch —
 *     see providers.ts:106 — which is not good enough when draining an account.)
 *   - Dry run is the default. Nothing is signed without --execute.
 *   - The DB is only updated after the transaction is confirmed on-chain.
 *
 * Usage:
 *   pnpm tsx scripts/recover-sol-payment.ts <deposit_address> <destination_address>
 *   pnpm tsx scripts/recover-sol-payment.ts <deposit_address> <destination_address> --execute
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { decrypt } from '../src/lib/crypto/encryption';

// Load .env.local if present, so ENCRYPTION_KEY never has to be typed on the
// command line (where it would land in shell history). Anything already in the
// environment — doppler, a CI secret — wins over the file.
const envLocal = join(process.cwd(), '.env.local');
if (existsSync(envLocal)) config({ path: envLocal, override: false });

/** Matches SolanaProvider.SOLANA_TX_FEE_LAMPORTS (providers.ts). */
const TX_FEE_LAMPORTS = 5000;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(9);

async function main() {
  const [depositAddress, destinationAddress] = process.argv.slice(2);
  const execute = process.argv.includes('--execute');

  if (!depositAddress || !destinationAddress || destinationAddress.startsWith('--')) {
    fail('Usage: pnpm tsx scripts/recover-sol-payment.ts <deposit_address> <destination_address> [--execute]');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!supabaseUrl || !supabaseKey) fail('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (!encryptionKey) fail('Missing ENCRYPTION_KEY — cannot decrypt the stored key');

  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const supabase = createClient(supabaseUrl, supabaseKey);
  const connection = new Connection(rpcUrl, 'confirmed');

  // ── Load the address record ───────────────────────────────────────────
  const { data: addr, error: addrErr } = await supabase
    .from('payment_addresses')
    .select('*')
    .eq('address', depositAddress)
    .maybeSingle();

  if (addrErr) fail(`payment_addresses lookup failed: ${addrErr.message}`);
  if (!addr) fail(`No payment_addresses row for ${depositAddress}`);
  if (!['SOL', 'USDT_SOL', 'USDC_SOL'].includes(addr.cryptocurrency)) {
    fail(`${depositAddress} is ${addr.cryptocurrency}, not a Solana address. This script only handles SOL.`);
  }
  if (addr.cryptocurrency !== 'SOL') {
    fail(`${addr.cryptocurrency} is an SPL token — sweeping it needs a token-account transfer, not a lamport transfer.`);
  }
  if (addr.is_escrow) {
    fail('This address holds escrow funds. Settle via /api/escrow/:id/settle, never a sweep.');
  }
  if (!addr.encrypted_private_key) {
    fail(`No stored key. Recover from the system mnemonic at ${addr.derivation_path}.`);
  }

  // ── Rebuild the keypair and PROVE it owns the address ─────────────────
  let keypair: Keypair;
  try {
    const seedHex = decrypt(addr.encrypted_private_key, encryptionKey);
    const seed = Buffer.from(seedHex, 'hex');
    if (seed.length !== 32) {
      fail(`Stored key is ${seed.length} bytes; expected a 32-byte ed25519 seed.`);
    }
    keypair = Keypair.fromSeed(Uint8Array.from(seed));
  } catch (err) {
    fail(`Could not rebuild the keypair: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (keypair.publicKey.toBase58() !== depositAddress) {
    fail(
      `KEY MISMATCH — refusing to sign.\n` +
        `  stored address : ${depositAddress}\n` +
        `  key derives to : ${keypair.publicKey.toBase58()}\n` +
        `  The ENCRYPTION_KEY or the stored key does not belong to this address.`,
    );
  }

  let destination: PublicKey;
  try {
    destination = new PublicKey(destinationAddress);
  } catch {
    fail(`Destination ${destinationAddress} is not a valid Solana address.`);
  }
  if (destination.toBase58() === depositAddress) {
    fail('Destination is the deposit address itself — nothing to do.');
  }

  // ── Work out what is actually sweepable ───────────────────────────────
  const balance = await connection.getBalance(keypair.publicKey);
  const sweepable = balance - TX_FEE_LAMPORTS;

  console.log('── Recovery plan ──────────────────────────────────');
  console.log(`from         : ${depositAddress}`);
  console.log(`  key verified: derives to this exact address ✓`);
  console.log(`to           : ${destination.toBase58()}`);
  console.log(`payment_id   : ${addr.payment_id}`);
  console.log(`balance      : ${balance} lamports (${sol(balance)} SOL)`);
  console.log(`network fee  : ${TX_FEE_LAMPORTS} lamports`);
  console.log(`sweeping     : ${sweepable} lamports (${sol(sweepable)} SOL)  [100% to merchant]`);
  console.log(`leaving      : 0 — the account is drained and closed`);

  if (sweepable <= 0) {
    fail(`Nothing to sweep: balance ${balance} does not cover the ${TX_FEE_LAMPORTS} lamport fee.`);
  }

  if (!execute) {
    console.log('\nDRY RUN — nothing signed or sent. Re-run with --execute to move the funds.');
    return;
  }

  // ── Send ──────────────────────────────────────────────────────────────
  console.log('\nSigning and broadcasting…');
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: destination,
      lamports: sweepable,
    }),
  );

  let signature: string;
  try {
    signature = await sendAndConfirmTransaction(connection, tx, [keypair], {
      commitment: 'confirmed',
    });
  } catch (err) {
    fail(`Broadcast failed, funds untouched: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`✓ Confirmed: ${signature}`);
  console.log(`  https://solscan.io/tx/${signature}`);

  // ── Reconcile the database (only now that the money has moved) ────────
  const nowIso = new Date().toISOString();
  const sweptSol = Number(sol(sweepable));

  const { error: paErr } = await supabase
    .from('payment_addresses')
    .update({ merchant_wallet: destination.toBase58(), is_used: true })
    .eq('address', depositAddress);
  if (paErr) console.error(`! payment_addresses update failed: ${paErr.message}`);

  const { error: pErr } = await supabase
    .from('payments')
    .update({
      status: 'forwarded',
      merchant_wallet_address: destination.toBase58(),
      forward_tx_hash: signature,
      merchant_amount: sweptSol,
      fee_amount: 0,
      forwarded_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', addr.payment_id);
  if (pErr) console.error(`! payments update failed: ${pErr.message}`);

  // Stamp the invoice so the recovery is auditable rather than looking like
  // the forwarding simply worked all along.
  const { data: inv } = await supabase
    .from('invoices')
    .select('id, metadata')
    .eq('payment_address', depositAddress)
    .maybeSingle();

  if (inv) {
    const { error: iErr } = await supabase
      .from('invoices')
      .update({
        merchant_wallet_address: destination.toBase58(),
        metadata: {
          ...(inv.metadata && typeof inv.metadata === 'object' ? inv.metadata : {}),
          recovered_at: nowIso,
          recovery_tx: signature,
          recovery_note: 'Stranded by expired-payment + empty-payee defect; swept 100% to merchant, no commission taken.',
        },
        updated_at: nowIso,
      })
      .eq('id', inv.id);
    if (iErr) console.error(`! invoice update failed: ${iErr.message}`);
    else console.log(`✓ Invoice ${inv.id} stamped with recovery details`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
