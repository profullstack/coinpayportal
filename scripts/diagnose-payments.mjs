#!/usr/bin/env node
/**
 * Diagnostic script to check payment data in the database
 * Run with: node scripts/diagnose-payments.mjs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log('\n=== Payment Data Diagnosis ===\n');

  // 0. Check businesses table
  console.log('0. Businesses in database:');
  const { data: businesses, error: bizError } = await supabase
    .from('businesses')
    .select('id, name, merchant_id');

  if (bizError) {
    console.error('Error fetching businesses:', bizError);
  } else {
    console.table(businesses?.map(b => ({
      id: b.id.slice(0, 8),
      name: b.name,
      merchant_id: b.merchant_id?.slice(0, 8) || 'null',
    })));
  }

  // 1. Get payment counts by status
  console.log('\n1. Payment counts by status:');
  const { data: payments, error } = await supabase
    .from('payments')
    .select('*');

  if (error) {
    console.error('Error fetching payments:', error);
    return;
  }

  const statusCounts = {};
  payments.forEach(p => {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  });
  console.table(statusCounts);

  // 2. Check amount values
  console.log('\n2. Sample payments with amounts:');
  const sample = payments.slice(0, 10).map(p => ({
    id: p.id.slice(0, 8),
    status: p.status,
    amount_usd: p.amount,
    crypto_amount: p.crypto_amount,
    fee_amount: p.fee_amount,
    merchant_amount: p.merchant_amount,
    blockchain: p.blockchain,
  }));
  console.table(sample);

  // 3. Sum amounts for forwarded payments
  console.log('\n3. Totals for forwarded/completed payments:');
  const successfulPayments = payments.filter(p =>
    ['completed', 'forwarded', 'forwarding'].includes(p.status)
  );

  const totals = {
    count: successfulPayments.length,
    total_amount_usd: successfulPayments.reduce((sum, p) => sum + parseFloat(p.amount || '0'), 0),
    total_crypto_amount: successfulPayments.reduce((sum, p) => sum + parseFloat(p.crypto_amount || '0'), 0),
    total_fee_amount: successfulPayments.reduce((sum, p) => sum + parseFloat(p.fee_amount || '0'), 0),
    total_merchant_amount: successfulPayments.reduce((sum, p) => sum + parseFloat(p.merchant_amount || '0'), 0),
  };
  console.table([totals]);

  // 4. Check for payments with 0 or null USD amount
  console.log('\n4. Payments with 0 or null USD amount:');
  const zeroAmountPayments = payments.filter(p =>
    !p.amount || parseFloat(p.amount) === 0
  );
  console.log(`Count: ${zeroAmountPayments.length} out of ${payments.length}`);

  // 4b. Check business_id distribution in payments
  console.log('\n4b. Business ID distribution in payments:');
  const businessIdCounts = {};
  payments.forEach(p => {
    const bizId = p.business_id ? p.business_id.slice(0, 8) : 'null';
    businessIdCounts[bizId] = (businessIdCounts[bizId] || 0) + 1;
  });
  console.table(businessIdCounts);

  // 4c. Check if payment business_ids exist in businesses table
  console.log('\n4c. Payments with business_id not in businesses table:');
  const businessIds = new Set(businesses?.map(b => b.id) || []);
  const orphanedPayments = payments.filter(p => p.business_id && !businessIds.has(p.business_id));
  console.log(`Orphaned payments: ${orphanedPayments.length} out of ${payments.length}`);
  if (orphanedPayments.length > 0) {
    console.log('Sample orphaned payment business_ids:');
    const uniqueOrphanBizIds = [...new Set(orphanedPayments.map(p => p.business_id))];
    console.log(uniqueOrphanBizIds.slice(0, 5));
  }

  if (zeroAmountPayments.length > 0) {
    console.log('\nSample of payments with 0/null amount:');
    console.table(zeroAmountPayments.slice(0, 5).map(p => ({
      id: p.id.slice(0, 8),
      status: p.status,
      amount_usd: p.amount,
      crypto_amount: p.crypto_amount,
      blockchain: p.blockchain,
    })));
  }

  // 5. Recommendation
  console.log('\n=== Recommendation ===');
  if (zeroAmountPayments.length > 0 && successfulPayments.length > 0) {
    const hasValidCryptoAmounts = successfulPayments.some(p => parseFloat(p.crypto_amount || '0') > 0);
    if (hasValidCryptoAmounts) {
      console.log('The USD amount column appears to be 0/null for some payments.');
      console.log('If crypto_amount and fee_amount have values, you may need to:');
      console.log('1. Calculate USD values from crypto amounts using exchange rates');
      console.log('2. Or run a data migration to populate the amount column');
    }
  } else {
    console.log('Data looks correct. Issue might be in the API code.');
  }
}

diagnose().catch(console.error);
