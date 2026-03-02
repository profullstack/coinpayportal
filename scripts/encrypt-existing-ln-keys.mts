#!/usr/bin/env npx tsx
/**
 * One-time migration: encrypt existing plaintext LNbits keys in the wallets table.
 * 
 * Usage:
 *   LN_KEY_ENCRYPTION_KEY=<64-hex-chars> \
 *   NEXT_PUBLIC_SUPABASE_URL=<url> \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   npx tsx scripts/encrypt-existing-ln-keys.ts [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '../src/lib/crypto/encryption';

const ENCRYPTED_PREFIX = 'enc:';
const dryRun = process.argv.includes('--dry-run');

const encKey = process.env.LN_KEY_ENCRYPTION_KEY;
if (!encKey || encKey.length !== 64) {
  console.error('LN_KEY_ENCRYPTION_KEY must be 64 hex chars');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: wallets, error } = await supabase
    .from('wallets')
    .select('id, ln_wallet_adminkey, ln_wallet_inkey')
    .or('ln_wallet_adminkey.not.is.null,ln_wallet_inkey.not.is.null');

  if (error) { console.error(error); process.exit(1); }
  if (!wallets?.length) { console.log('No wallets with LN keys found.'); return; }

  let updated = 0;
  for (const w of wallets) {
    const patch: Record<string, string> = {};

    if (w.ln_wallet_adminkey && !w.ln_wallet_adminkey.startsWith(ENCRYPTED_PREFIX)) {
      patch.ln_wallet_adminkey = ENCRYPTED_PREFIX + encrypt(w.ln_wallet_adminkey, encKey);
    }
    if (w.ln_wallet_inkey && !w.ln_wallet_inkey.startsWith(ENCRYPTED_PREFIX)) {
      patch.ln_wallet_inkey = ENCRYPTED_PREFIX + encrypt(w.ln_wallet_inkey, encKey);
    }

    if (Object.keys(patch).length === 0) {
      console.log(`  ${w.id}: already encrypted, skipping`);
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] ${w.id}: would encrypt ${Object.keys(patch).join(', ')}`);
    } else {
      const { error: updateError } = await supabase
        .from('wallets')
        .update(patch)
        .eq('id', w.id);
      if (updateError) {
        console.error(`  ${w.id}: FAILED`, updateError.message);
      } else {
        console.log(`  ${w.id}: encrypted ${Object.keys(patch).join(', ')}`);
      }
    }
    updated++;
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}${updated}/${wallets.length} wallets processed.`);
}

main();
