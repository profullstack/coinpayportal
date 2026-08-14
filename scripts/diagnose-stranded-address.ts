/**
 * Diagnose a single stranded CoinPay payment address.
 *
 * Read-only. Answers three questions about an address whose funds never
 * reached the merchant:
 *   1. What is actually sitting on-chain at it right now?
 *   2. Is it still spendable by us (does the stored key decrypt)?
 *   3. Which defect stranded it, and therefore what the recovery has to fix?
 *
 * It never moves funds and never prints key material.
 *
 * Usage:
 *   pnpm tsx scripts/diagnose-stranded-address.ts <payment_address>
 */

import { createClient } from '@supabase/supabase-js';
import { decrypt } from '../src/lib/crypto/encryption';
import { checkBalance } from '../src/lib/payments/monitor-balance';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const address = process.argv[2];
  if (!address) {
    fail('Usage: pnpm tsx scripts/diagnose-stranded-address.ts <payment_address>');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    fail('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── 1. The derived address record ─────────────────────────────────────
  const { data: addr, error: addrErr } = await supabase
    .from('payment_addresses')
    .select('*')
    .eq('address', address)
    .maybeSingle();

  if (addrErr) fail(`payment_addresses lookup failed: ${addrErr.message}`);
  if (!addr) {
    fail(
      `No payment_addresses row for ${address}.\n` +
        'This address was not derived by the system wallet — recovery via the ' +
        'stored key is not possible. Check that the address was copied correctly.',
    );
  }

  console.log('── Derived address ────────────────────────────────');
  console.log(`address          : ${addr.address}`);
  console.log(`cryptocurrency   : ${addr.cryptocurrency}`);
  console.log(`derivation_path  : ${addr.derivation_path}`);
  console.log(`derivation_index : ${addr.derivation_index}`);
  console.log(`business_id      : ${addr.business_id}`);
  console.log(`payment_id       : ${addr.payment_id}`);
  console.log(`amount_expected  : ${addr.amount_expected}`);
  console.log(`merchant_wallet  : ${addr.merchant_wallet === '' ? '(EMPTY)' : addr.merchant_wallet}`);
  console.log(`commission_wallet: ${addr.commission_wallet}`);
  console.log(`is_escrow        : ${addr.is_escrow ?? false}`);

  // ── 2. The payment record ─────────────────────────────────────────────
  const { data: payment } = await supabase
    .from('payments')
    .select('*')
    .eq('id', addr.payment_id)
    .maybeSingle();

  console.log('\n── Payment ────────────────────────────────────────');
  if (!payment) {
    console.log('(no payments row — the address is orphaned)');
  } else {
    console.log(`status           : ${payment.status}`);
    console.log(`crypto_amount    : ${payment.crypto_amount} ${payment.blockchain}`);
    console.log(`created_at       : ${payment.created_at}`);
    console.log(`expires_at       : ${payment.expires_at}`);
    console.log(`confirmed_at     : ${payment.confirmed_at ?? '—'}`);
    console.log(`forward_tx_hash  : ${payment.forward_tx_hash ?? '—'}`);
    console.log(`merchant_wallet_address: ${payment.merchant_wallet_address || '(EMPTY)'}`);
  }

  // ── 3. The invoice, if any ────────────────────────────────────────────
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, paid_at, tx_hash, crypto_currency, crypto_amount, merchant_wallet_address, business_id, user_id, metadata')
    .eq('payment_address', address);

  console.log('\n── Invoice ────────────────────────────────────────');
  if (!invoices?.length) {
    console.log('(no invoice references this address)');
  } else {
    for (const inv of invoices) {
      console.log(`invoice_number   : ${inv.invoice_number}`);
      console.log(`status           : ${inv.status}`);
      console.log(`paid_at          : ${inv.paid_at ?? '—'}`);
      console.log(`payee            : ${inv.merchant_wallet_address || '(EMPTY)'}`);
      console.log(`linked payment   : ${(inv.metadata as any)?.coinpay_payment_id ?? '(none — unlinked invoice)'}`);
    }
  }

  // ── 4. What is actually on-chain ──────────────────────────────────────
  console.log('\n── On-chain ───────────────────────────────────────');
  let onChain = 0;
  try {
    const balance = await checkBalance(addr.address, addr.cryptocurrency);
    onChain = balance.balance;
    console.log(`balance          : ${balance.balance} ${addr.cryptocurrency}`);
    console.log(`deposit tx       : ${balance.txHash ?? '—'}`);
  } catch (err) {
    console.log(`balance lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 5. Is it still spendable by us? ───────────────────────────────────
  console.log('\n── Spendability ───────────────────────────────────');
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.log('ENCRYPTION_KEY not set — cannot verify the stored key decrypts.');
  } else if (!addr.encrypted_private_key) {
    console.log('NO STORED KEY — funds are only recoverable from the system mnemonic ' +
      `at ${addr.derivation_path}.`);
  } else {
    try {
      const pk = decrypt(addr.encrypted_private_key, encryptionKey);
      // Never print key material — length alone proves a clean decrypt.
      console.log(`stored key decrypts OK (${pk.length} chars). Funds are spendable.`);
    } catch (err) {
      console.log(`STORED KEY FAILED TO DECRYPT: ${err instanceof Error ? err.message : String(err)}`);
      console.log('ENCRYPTION_KEY may have rotated since this address was created.');
    }
  }

  // ── 6. Diagnosis ──────────────────────────────────────────────────────
  console.log('\n── Diagnosis ──────────────────────────────────────');
  const findings: string[] = [];

  if (addr.merchant_wallet === '' || addr.merchant_wallet == null) {
    findings.push(
      'PAYEE MISSING: payment_addresses.merchant_wallet is empty, so forwarding ' +
        'throws on an empty recipient and no leg of the split is sent. Recovery ' +
        'must set a real payout address before re-forwarding.',
    );
  }
  if (payment?.status === 'expired') {
    findings.push(
      'EXPIRED: the payment was marked expired by the 15-minute window, and ' +
        'monitorPayments only polls status=pending — nothing will ever revisit ' +
        'this address on its own.',
    );
  }
  if (payment && !['forwarded'].includes(payment.status) && onChain > 0) {
    findings.push(`FUNDS PRESENT AND UNFORWARDED: ${onChain} ${addr.cryptocurrency} is sitting at the derived address.`);
  }
  if (invoices?.some((i) => i.status === 'paid') && payment?.status !== 'forwarded') {
    findings.push(
      'INVOICE MARKED PAID WITHOUT FORWARDING: the invoice was settled by a path ' +
        'that never triggered the forwarding pipeline (check-balance route or the ' +
        'invoice monitor stub).',
    );
  }
  if (addr.is_escrow) {
    findings.push('ESCROW-HELD: auto-forwarding is intentionally skipped. Settle via /api/escrow/:id/settle, not a sweep.');
  }

  if (!findings.length) {
    console.log('Nothing anomalous found — this address looks normal.');
  } else {
    for (const f of findings) console.log(`• ${f}`);
  }

  console.log('\n(read-only — nothing was modified)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
