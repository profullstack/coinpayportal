import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import * as bitcoin from 'bitcoinjs-lib';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * CashAddr charset for decoding
 */
const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Convert CashAddr to legacy Bitcoin address format
 * CashAddr format: bitcoincash:qp... -> Legacy format: 1... or 3...
 */
function cashAddrToLegacy(cashAddr: string): string {
  // Remove prefix if present
  let address = cashAddr.toLowerCase();
  if (address.startsWith('bitcoincash:')) {
    address = address.substring(12);
  }
  
  // Decode base32
  const data: number[] = [];
  for (const char of address) {
    const index = CASHADDR_CHARSET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid CashAddr character: ${char}`);
    }
    data.push(index);
  }
  
  // Remove checksum (last 8 characters = 40 bits)
  const payload = data.slice(0, -8);
  
  // Convert from 5-bit to 8-bit
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  
  for (const value of payload) {
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }
  
  // First byte is version, rest is hash160
  const version = result[0];
  const hash160 = result.slice(1, 21);
  
  // Convert to legacy address
  // Version 0 = P2PKH (starts with 1)
  // Version 8 = P2SH (starts with 3)
  const legacyVersion = version === 0 ? 0x00 : 0x05;
  
  // Build legacy address: version + hash160 + checksum
  const payload2 = Buffer.concat([
    Buffer.from([legacyVersion]),
    Buffer.from(hash160)
  ]);
  
  // Double SHA256 for checksum
  const checksum = bitcoin.crypto.hash256(payload2).subarray(0, 4);
  const addressBytes = Buffer.concat([payload2, checksum]);
  
  // Base58 encode
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (let i = 0; i < addressBytes.length; i++) {
    let carry = addressBytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  
  let legacyAddress = '';
  // Leading zeros
  for (let i = 0; i < addressBytes.length && addressBytes[i] === 0; i++) {
    legacyAddress += BASE58_ALPHABET[0];
  }
  // Convert digits to string
  for (let i = digits.length - 1; i >= 0; i--) {
    legacyAddress += BASE58_ALPHABET[digits[i]];
  }
  
  return legacyAddress;
}

/**
 * Convert BCH address to legacy format if needed
 */
function toBCHLegacyAddress(address: string): string {
  if (address.startsWith('bitcoincash:') || address.startsWith('q') || address.startsWith('p')) {
    try {
      return cashAddrToLegacy(address);
    } catch (error) {
      console.error('[BCH] Failed to convert CashAddr to legacy:', error);
      return address;
    }
  }
  return address;
}

// RPC endpoints for different blockchains
const RPC_ENDPOINTS: Record<string, string> = {
  BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
  BCH: process.env.BCH_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet',
  ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  BNB: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
  DOGE: process.env.DOGE_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/dogecoin/mainnet',
  XRP: process.env.XRP_RPC_URL || 'https://xrplcluster.com',
  ADA: process.env.ADA_RPC_URL || 'https://cardano-mainnet.blockfrost.io/api/v0',
};

// API keys
const CRYPTO_APIS_KEY = process.env.CRYPTO_APIS_KEY || '';

/**
 * Check balance for a Bitcoin address using Blockstream API
 */
async function checkBitcoinBalance(address: string): Promise<number> {
  try {
    console.log(`Checking BTC balance for ${address}`);
    const response = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!response.ok) {
      console.error(`Failed to fetch BTC balance for ${address}: ${response.status}`);
      return 0;
    }
    
    const data = await response.json();
    // Balance is in satoshis, convert to BTC
    const balanceSatoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
    const balanceBTC = balanceSatoshis / 100_000_000;
    console.log(`BTC balance for ${address}: ${balanceSatoshis} satoshis = ${balanceBTC} BTC`);
    return balanceBTC;
  } catch (error) {
    console.error(`Error checking BTC balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Bitcoin Cash address using Crypto APIs
 * Supports both CashAddr (bitcoincash:q...) and legacy (1...) formats
 */
async function checkBCHBalance(address: string): Promise<number> {
  try {
    // Convert CashAddr to legacy format for API compatibility
    const legacyAddress = toBCHLegacyAddress(address);
    console.log(`[BCH Balance] Original: ${address}`);
    console.log(`[BCH Balance] Legacy: ${legacyAddress}`);
    
    // Try Tatum API first (most reliable for BCH)
    const tatumApiKey = process.env.TATUM_API_KEY;
    if (tatumApiKey) {
      try {
        const tatumUrl = `https://api.tatum.io/v3/bcash/address/balance/${legacyAddress}`;
        console.log(`[BCH Balance] Tatum URL: ${tatumUrl}`);
        
        const response = await fetch(tatumUrl, {
          method: 'GET',
          headers: {
            'x-api-key': tatumApiKey,
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          // Tatum returns incoming and outgoing, balance = incoming - outgoing
          const incoming = parseFloat(data.incoming || '0');
          const outgoing = parseFloat(data.outgoing || '0');
          const balance = incoming - outgoing;
          console.log(`[BCH Balance] Tatum response: incoming=${incoming}, outgoing=${outgoing}, balance=${balance}`);
          return balance;
        } else {
          const errorText = await response.text();
          console.error(`[BCH Balance] Tatum failed for ${legacyAddress}: ${response.status} - ${errorText}`);
        }
      } catch (tatumError) {
        console.error(`[BCH Balance] Tatum error for ${legacyAddress}:`, tatumError);
      }
    }
    
    // Try CryptoAPIs with UTXO balance endpoint (correct format for BCH)
    // CryptoAPIs accepts CashAddr format without the bitcoincash: prefix
    // Check both CRYPTO_APIS_KEY and CRYPTOAPIS_API_KEY (common variations)
    const cryptoApisKey = CRYPTO_APIS_KEY || process.env.CRYPTOAPIS_API_KEY || '';
    console.log(`[BCH Balance] CRYPTO_APIS_KEY configured: ${cryptoApisKey ? 'yes (length=' + cryptoApisKey.length + ')' : 'no'}`);
    if (cryptoApisKey) {
      try {
        // Remove bitcoincash: prefix if present, CryptoAPIs accepts the short CashAddr format
        let cashAddrShort = address.toLowerCase();
        if (cashAddrShort.startsWith('bitcoincash:')) {
          cashAddrShort = cashAddrShort.substring(12);
        }
        
        const url = `https://rest.cryptoapis.io/addresses-latest/utxo/bitcoin-cash/mainnet/${cashAddrShort}/balance`;
        console.log(`[BCH Balance] CryptoAPIs URL: ${url}`);
        console.log(`[BCH Balance] CryptoAPIs API Key: ${cryptoApisKey.substring(0, 8)}...`);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': cryptoApisKey,
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          // Response format: { data: { item: { confirmedBalance: { amount: "0.001", unit: "BCH" } } } }
          const confirmedBalance = parseFloat(data.data?.item?.confirmedBalance?.amount || '0');
          console.log(`[BCH Balance] CryptoAPIs response:`, JSON.stringify(data.data?.item));
          console.log(`[BCH Balance] CryptoAPIs balance: ${confirmedBalance} BCH`);
          return confirmedBalance;
        } else {
          const errorText = await response.text();
          console.error(`[BCH Balance] CryptoAPIs failed for ${cashAddrShort}: ${response.status} - ${errorText}`);
        }
      } catch (cryptoApisError) {
        console.error(`[BCH Balance] CryptoAPIs error:`, cryptoApisError);
      }
    }
    
    // Fallback to Blockstream-style API (fullstack.cash)
    try {
      const fullstackUrl = `https://api.fullstack.cash/v5/electrumx/balance/${address}`;
      console.log(`[BCH Balance] Fullstack.cash URL: ${fullstackUrl}`);
      const fullstackResponse = await fetch(fullstackUrl);
      
      if (fullstackResponse.ok) {
        const fullstackData = await fullstackResponse.json();
        if (fullstackData.success) {
          const balanceSatoshis = (fullstackData.balance?.confirmed || 0) + (fullstackData.balance?.unconfirmed || 0);
          const balanceBCH = balanceSatoshis / 100_000_000;
          console.log(`[BCH Balance] Fullstack.cash balance: ${balanceBCH} BCH`);
          return balanceBCH;
        }
      } else {
        const errorText = await fullstackResponse.text();
        console.error(`[BCH Balance] Fullstack.cash failed for ${address}: ${fullstackResponse.status} - ${errorText}`);
      }
    } catch (fullstackError) {
      console.error(`[BCH Balance] Fullstack.cash error for ${address}:`, fullstackError);
    }
    
    // Fallback to Blockchair API (may be rate limited)
    try {
      const blockchairUrl = `https://api.blockchair.com/bitcoin-cash/dashboards/address/${legacyAddress}`;
      console.log(`[BCH Balance] Blockchair URL: ${blockchairUrl}`);
      const blockchairResponse = await fetch(blockchairUrl);
      
      if (blockchairResponse.ok) {
        const blockchairData = await blockchairResponse.json();
        const balanceSatoshis = blockchairData?.data?.[legacyAddress]?.address?.balance || 0;
        const balanceBCH = balanceSatoshis / 100_000_000;
        console.log(`[BCH Balance] Blockchair balance: ${balanceBCH} BCH`);
        return balanceBCH;
      } else {
        const errorText = await blockchairResponse.text();
        console.error(`[BCH Balance] Blockchair failed for ${legacyAddress}: ${blockchairResponse.status} - ${errorText}`);
      }
    } catch (blockchairError) {
      console.error(`[BCH Balance] Blockchair error for ${legacyAddress}:`, blockchairError);
    }
    
    console.error(`[BCH Balance] All APIs failed for ${address}`);
    return 0;
  } catch (error) {
    console.error(`[BCH Balance] Error checking balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for an Ethereum/Polygon address using JSON-RPC
 */
async function checkEVMBalance(address: string, rpcUrl: string): Promise<number> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch EVM balance for ${address}: ${response.status}`);
      return 0;
    }
    
    const data = await response.json();
    if (data.error) {
      console.error(`RPC error for ${address}:`, data.error);
      return 0;
    }
    
    // Balance is in wei, convert to ETH
    const balanceWei = BigInt(data.result || '0x0');
    return Number(balanceWei) / 1e18;
  } catch (error) {
    console.error(`Error checking EVM balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Solana address
 */
async function checkSolanaBalance(address: string, rpcUrl: string): Promise<number> {
  try {
    console.log(`Checking Solana balance for ${address} using ${rpcUrl}`);
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
        id: 1,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch Solana balance for ${address}: ${response.status} - ${errorText}`);
      return 0;
    }
    
    const data = await response.json();
    console.log(`Solana RPC response for ${address}:`, JSON.stringify(data));
    
    if (data.error) {
      console.error(`RPC error for ${address}:`, data.error);
      return 0;
    }
    
    // Balance is in lamports, convert to SOL
    const balanceLamports = data.result?.value || 0;
    const balanceSOL = balanceLamports / 1e9;
    console.log(`Solana balance for ${address}: ${balanceLamports} lamports = ${balanceSOL} SOL`);
    return balanceSOL;
  } catch (error) {
    console.error(`Error checking Solana balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for any supported blockchain
 */
async function checkBalance(address: string, blockchain: string): Promise<number> {
  console.log(`Checking balance for ${blockchain} address: ${address}`);
  
  switch (blockchain) {
    case 'BTC':
      return checkBitcoinBalance(address);
    case 'BCH':
      return checkBCHBalance(address);
    case 'ETH':
    case 'USDC_ETH':
    case 'USDT':
    case 'USDC':
      return checkEVMBalance(address, RPC_ENDPOINTS.ETH);
    case 'POL':
    case 'USDC_POL':
      return checkEVMBalance(address, RPC_ENDPOINTS.POL);
    case 'SOL':
    case 'USDC_SOL':
      return checkSolanaBalance(address, RPC_ENDPOINTS.SOL);
    case 'BNB':
      return checkEVMBalance(address, RPC_ENDPOINTS.BNB);
    case 'DOGE':
      // DOGE uses similar API to BCH via CryptoAPIs
      console.log(`DOGE balance check not yet implemented for ${address}`);
      return 0;
    case 'XRP':
      // XRP requires special handling
      console.log(`XRP balance check not yet implemented for ${address}`);
      return 0;
    case 'ADA':
      // ADA requires Blockfrost API
      console.log(`ADA balance check not yet implemented for ${address}`);
      return 0;
    default:
      console.error(`Unsupported blockchain: ${blockchain}`);
      return 0;
  }
}

/**
 * POST /api/payments/[id]/check-balance
 * Check blockchain balance and update payment status if funds detected
 * 
 * This endpoint is called by the frontend during polling to actively check
 * for incoming payments, providing faster detection than the scheduled Edge Function.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: paymentId } = await params;
    
    // Create Supabase client with service role for admin access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get the payment
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();
    
    if (paymentError || !payment) {
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 }
      );
    }
    
    // Only check pending payments
    if (payment.status !== 'pending') {
      return NextResponse.json({
        success: true,
        status: payment.status,
        message: `Payment is already ${payment.status}`,
      });
    }
    
    // Check if payment has expired
    if (payment.expires_at && new Date(payment.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from('payments')
        .update({
          status: 'expired',
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);
      
      return NextResponse.json({
        success: true,
        status: 'expired',
        message: 'Payment has expired',
      });
    }
    
    // Check if we have a payment address
    if (!payment.payment_address) {
      return NextResponse.json({
        success: false,
        error: 'Payment has no address to check',
      });
    }
    
    // Check blockchain balance
    const balance = await checkBalance(payment.payment_address, payment.blockchain);
    console.log(`Payment ${paymentId}: blockchain=${payment.blockchain}, address=${payment.payment_address}, balance=${balance}, expected=${payment.crypto_amount}`);
    
    // Check if sufficient funds received (allow 1% tolerance for network fees)
    const expectedAmount = parseFloat(payment.crypto_amount);
    const tolerance = expectedAmount * 0.01;
    
    if (balance >= expectedAmount - tolerance) {
      const now = new Date().toISOString();
      
      // Mark as confirmed
      await supabase
        .from('payments')
        .update({
          status: 'confirmed',
          updated_at: now,
        })
        .eq('id', paymentId);
      
      console.log(`Payment ${paymentId} confirmed with balance ${balance}`);
      
      // Trigger forwarding
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
      const internalApiKey = process.env.INTERNAL_API_KEY;
      
      if (internalApiKey) {
        try {
          const forwardResponse = await fetch(`${appUrl}/api/payments/${paymentId}/forward`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${internalApiKey}`,
            },
          });
          
          if (!forwardResponse.ok) {
            const errorText = await forwardResponse.text();
            console.error(`Failed to trigger forwarding for ${paymentId}: ${forwardResponse.status} - ${errorText}`);
          } else {
            console.log(`Forwarding triggered for payment ${paymentId}`);
          }
        } catch (forwardError) {
          console.error(`Error triggering forwarding for ${paymentId}:`, forwardError);
        }
      } else {
        console.warn('INTERNAL_API_KEY not set, skipping automatic forwarding');
      }
      
      return NextResponse.json({
        success: true,
        status: 'confirmed',
        balance,
        message: 'Payment confirmed! Funds detected.',
      });
    }
    
    return NextResponse.json({
      success: true,
      status: 'pending',
      balance,
      expected: expectedAmount,
      message: balance > 0 
        ? `Partial payment detected: ${balance} / ${expectedAmount}` 
        : 'Waiting for payment...',
    });
  } catch (error) {
    console.error('Check balance error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check balance',
      },
      { status: 500 }
    );
  }
}