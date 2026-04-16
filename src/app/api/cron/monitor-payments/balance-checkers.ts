/**
 * Blockchain Balance Checkers
 *
 * Functions to check on-chain balances for various blockchains.
 * Used by the payment/escrow monitor to detect deposits.
 */

import * as bitcoin from 'bitcoinjs-lib';

/**
 * CashAddr charset for decoding
 */
const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Convert CashAddr to legacy Bitcoin address format
 * CashAddr format: bitcoincash:qp... -> Legacy format: 1... or 3...
 */
export function cashAddrToLegacy(cashAddr: string): string {
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
export function toBCHLegacyAddress(address: string): string {
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
export const RPC_ENDPOINTS: Record<string, string> = {
  BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
  BCH: process.env.BCH_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet',
  ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  BNB: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
  DOGE: process.env.DOGE_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/dogecoin/mainnet',
  XRP: process.env.XRP_RPC_URL || 'https://xrplcluster.com',
  ADA: process.env.ADA_RPC_URL || 'https://cardano-mainnet.blockfrost.io/api/v0',
  BASE: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
};

const EVM_TOKENS = {
  USDT_ETH: { contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDT_POL: { contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  USDC_ETH: { contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  USDC_POL: { contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  USDC_BASE: { contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
} as const;

const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';
const SOLANA_TOKENS = {
  USDT_SOL: { mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  USDC_SOL: { mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
} as const;

// API keys
const CRYPTO_APIS_KEY = process.env.CRYPTO_APIS_KEY || '';

/**
 * Check balance for a Bitcoin address using Blockstream API
 */
export async function checkBitcoinBalance(address: string): Promise<number> {
  try {
    const response = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!response.ok) {
      console.error(`Failed to fetch BTC balance for ${address}: ${response.status}`);
      return 0;
    }
    
    const data = await response.json();
    const balanceSatoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
    return balanceSatoshis / 100_000_000;
  } catch (error) {
    console.error(`Error checking BTC balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Bitcoin Cash address using Crypto APIs
 * Supports both CashAddr (bitcoincash:q...) and legacy (1...) formats
 */
export async function checkBCHBalance(address: string): Promise<number> {
  try {
    const legacyAddress = toBCHLegacyAddress(address);
    console.log(`[Monitor BCH] Original address: ${address}`);
    console.log(`[Monitor BCH] Legacy address: ${legacyAddress}`);
    
    // Try Tatum API first (most reliable for BCH)
    const tatumApiKey = process.env.TATUM_API_KEY;
    if (tatumApiKey) {
      try {
        const tatumUrl = `https://api.tatum.io/v3/bcash/address/balance/${legacyAddress}`;
        console.log(`[Monitor BCH] Tatum URL: ${tatumUrl}`);
        
        const response = await fetch(tatumUrl, {
          method: 'GET',
          headers: { 'x-api-key': tatumApiKey },
        });
        
        if (response.ok) {
          const data = await response.json();
          const incoming = parseFloat(data.incoming || '0');
          const outgoing = parseFloat(data.outgoing || '0');
          const balance = incoming - outgoing;
          console.log(`[Monitor BCH] Tatum response: incoming=${incoming}, outgoing=${outgoing}, balance=${balance}`);
          return balance;
        } else {
          const errorText = await response.text();
          console.error(`[Monitor BCH] Tatum failed for ${legacyAddress}: ${response.status} - ${errorText}`);
        }
      } catch (tatumError) {
        console.error(`[Monitor BCH] Tatum error for ${legacyAddress}:`, tatumError);
      }
    }
    
    // Try CryptoAPIs
    const cryptoApisKey = CRYPTO_APIS_KEY || process.env.CRYPTOAPIS_API_KEY || '';
    console.log(`[Monitor BCH] CRYPTO_APIS_KEY configured: ${cryptoApisKey ? 'yes (length=' + cryptoApisKey.length + ')' : 'no'}`);
    if (cryptoApisKey) {
      try {
        let cashAddrShort = address.toLowerCase();
        if (cashAddrShort.startsWith('bitcoincash:')) {
          cashAddrShort = cashAddrShort.substring(12);
        }
        
        const url = `https://rest.cryptoapis.io/addresses-latest/utxo/bitcoin-cash/mainnet/${cashAddrShort}/balance`;
        console.log(`[Monitor BCH] CryptoAPIs URL: ${url}`);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': cryptoApisKey,
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          const confirmedBalance = parseFloat(data.data?.item?.confirmedBalance?.amount || '0');
          console.log(`[Monitor BCH] CryptoAPIs balance: ${confirmedBalance} BCH`);
          return confirmedBalance;
        } else {
          const errorText = await response.text();
          console.error(`[Monitor BCH] CryptoAPIs failed for ${cashAddrShort}: ${response.status} - ${errorText}`);
        }
      } catch (cryptoApisError) {
        console.error(`[Monitor BCH] CryptoAPIs error:`, cryptoApisError);
      }
    }
    
    // Fallback to fullstack.cash
    try {
      const fullstackUrl = `https://api.fullstack.cash/v5/electrumx/balance/${address}`;
      const fullstackResponse = await fetch(fullstackUrl);
      
      if (fullstackResponse.ok) {
        const fullstackData = await fullstackResponse.json();
        if (fullstackData.success) {
          const balanceSatoshis = (fullstackData.balance?.confirmed || 0) + (fullstackData.balance?.unconfirmed || 0);
          return balanceSatoshis / 100_000_000;
        }
      }
    } catch (fullstackError) {
      console.error(`[Monitor BCH] Fullstack.cash error for ${address}:`, fullstackError);
    }
    
    // Fallback to Blockchair
    try {
      const blockchairUrl = `https://api.blockchair.com/bitcoin-cash/dashboards/address/${legacyAddress}`;
      const blockchairResponse = await fetch(blockchairUrl);
      
      if (blockchairResponse.ok) {
        const blockchairData = await blockchairResponse.json();
        const balanceSatoshis = blockchairData?.data?.[legacyAddress]?.address?.balance || 0;
        return balanceSatoshis / 100_000_000;
      }
    } catch (blockchairError) {
      console.error(`[Monitor BCH] Blockchair error for ${legacyAddress}:`, blockchairError);
    }
    
    console.error(`[Monitor BCH] All APIs failed for ${address}`);
    return 0;
  } catch (error) {
    console.error(`[Monitor BCH] Error checking balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for an Ethereum/Polygon address using JSON-RPC
 */
export async function checkEVMBalance(address: string, rpcUrl: string): Promise<number> {
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
    
    const balanceWei = BigInt(data.result || '0x0');
    return Number(balanceWei) / 1e18;
  } catch (error) {
    console.error(`Error checking EVM balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check ERC-20 token balance for an EVM address using eth_call balanceOf(address)
 */
export async function checkEVMTokenBalance(
  address: string,
  rpcUrl: string,
  contractAddress: string,
  decimals: number = 6
): Promise<number> {
  try {
    const paddedAddress = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const callData = `${ERC20_BALANCE_OF_SELECTOR}${paddedAddress}`;

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: contractAddress, data: callData }, 'latest'],
        id: 1,
      }),
    });

    if (!response.ok) {
      console.error(`Failed to fetch EVM token balance for ${address}: ${response.status}`);
      return 0;
    }

    const data = await response.json();
    if (data.error) {
      console.error(`RPC error for token balance ${address}:`, data.error);
      return 0;
    }

    const balanceRaw = BigInt(data.result || '0x0');
    return Number(balanceRaw) / 10 ** decimals;
  } catch (error) {
    console.error(`Error checking EVM token balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Solana address
 */
export async function checkSolanaBalance(address: string, rpcUrl: string): Promise<number> {
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
 * Check SPL token balance for a Solana address by mint.
 */
export async function checkSolanaTokenBalance(
  address: string,
  rpcUrl: string,
  mintAddress: string,
  decimals: number = 6
): Promise<number> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          { mint: mintAddress },
          { encoding: 'jsonParsed' },
        ],
        id: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch Solana token balance for ${address}: ${response.status} - ${errorText}`);
      return 0;
    }

    const data = await response.json();
    if (data.error) {
      console.error(`RPC error for Solana token balance ${address}:`, data.error);
      return 0;
    }

    const accounts = data.result?.value || [];
    let totalBalance = 0;

    for (const account of accounts) {
      const tokenAmount = account?.account?.data?.parsed?.info?.tokenAmount;
      if (typeof tokenAmount?.uiAmount === 'number') {
        totalBalance += tokenAmount.uiAmount;
        continue;
      }

      const rawAmount = tokenAmount?.amount;
      if (typeof rawAmount === 'string') {
        totalBalance += Number(rawAmount) / 10 ** decimals;
      }
    }

    return totalBalance;
  } catch (error) {
    console.error(`Error checking Solana token balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for an XRP address using XRPL JSON-RPC
 */
export async function checkXRPBalance(address: string, rpcUrl: string): Promise<number> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_info',
        params: [{ account: address, ledger_index: 'validated' }],
      }),
    });

    if (!response.ok) {
      console.error(`Failed to fetch XRP balance for ${address}: ${response.status}`);
      return 0;
    }

    const data = await response.json();

    if (data.result?.error === 'actNotFound') {
      return 0;
    }

    if (data.result?.error) {
      console.error(`XRP RPC error for ${address}:`, data.result.error);
      return 0;
    }

    const balanceDrops = parseInt(data.result?.account_data?.Balance || '0', 10);
    return balanceDrops / 1_000_000;
  } catch (error) {
    console.error(`Error checking XRP balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Cardano (ADA) address using Blockfrost API
 */
export async function checkADABalance(address: string, rpcUrl: string): Promise<number> {
  try {
    const apiKey = process.env.BLOCKFROST_API_KEY;
    if (!apiKey) {
      console.error('[ADA] BLOCKFROST_API_KEY not configured');
      return 0;
    }

    const response = await fetch(`${rpcUrl}/addresses/${address}`, {
      method: 'GET',
      headers: { 'project_id': apiKey },
    });

    if (response.status === 404) {
      return 0;
    }

    if (!response.ok) {
      console.error(`Failed to fetch ADA balance for ${address}: ${response.status}`);
      return 0;
    }

    const data = await response.json();
    const lovelaceEntry = (data.amount || []).find((a: { unit: string; quantity: string }) => a.unit === 'lovelace');
    const lovelace = parseInt(lovelaceEntry?.quantity || '0', 10);
    return lovelace / 1_000_000;
  } catch (error) {
    console.error(`Error checking ADA balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for any supported blockchain
 */
export async function checkBalance(address: string, blockchain: string): Promise<number> {
  switch (blockchain) {
    case 'BTC':
      return checkBitcoinBalance(address);
    case 'BCH':
      return checkBCHBalance(address);
    case 'ETH':
      return checkEVMBalance(address, RPC_ENDPOINTS.ETH);
    case 'USDT':
    case 'USDT_ETH':
      return checkEVMTokenBalance(address, RPC_ENDPOINTS.ETH, EVM_TOKENS.USDT_ETH.contractAddress, EVM_TOKENS.USDT_ETH.decimals);
    case 'USDC':
    case 'USDC_ETH':
      return checkEVMTokenBalance(address, RPC_ENDPOINTS.ETH, EVM_TOKENS.USDC_ETH.contractAddress, EVM_TOKENS.USDC_ETH.decimals);
    case 'POL':
      return checkEVMBalance(address, RPC_ENDPOINTS.POL);
    case 'USDT_POL':
      return checkEVMTokenBalance(address, RPC_ENDPOINTS.POL, EVM_TOKENS.USDT_POL.contractAddress, EVM_TOKENS.USDT_POL.decimals);
    case 'USDC_POL':
      return checkEVMTokenBalance(address, RPC_ENDPOINTS.POL, EVM_TOKENS.USDC_POL.contractAddress, EVM_TOKENS.USDC_POL.decimals);
    case 'USDC_BASE':
      return checkEVMTokenBalance(address, RPC_ENDPOINTS.BASE, EVM_TOKENS.USDC_BASE.contractAddress, EVM_TOKENS.USDC_BASE.decimals);
    case 'SOL':
      return checkSolanaBalance(address, RPC_ENDPOINTS.SOL);
    case 'USDT_SOL':
      return checkSolanaTokenBalance(address, RPC_ENDPOINTS.SOL, SOLANA_TOKENS.USDT_SOL.mintAddress, SOLANA_TOKENS.USDT_SOL.decimals);
    case 'USDC_SOL':
      return checkSolanaTokenBalance(address, RPC_ENDPOINTS.SOL, SOLANA_TOKENS.USDC_SOL.mintAddress, SOLANA_TOKENS.USDC_SOL.decimals);
    case 'BNB':
      return checkEVMBalance(address, RPC_ENDPOINTS.BNB);
    case 'DOGE':
      console.log(`DOGE balance check not yet implemented for ${address}`);
      return 0;
    case 'XRP':
      return checkXRPBalance(address, RPC_ENDPOINTS.XRP);
    case 'ADA':
      return checkADABalance(address, RPC_ENDPOINTS.ADA);
    default:
      console.error(`Unsupported blockchain: ${blockchain}`);
      return 0;
  }
}
