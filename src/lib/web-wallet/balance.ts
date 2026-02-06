/**
 * Web Wallet Balance Service
 *
 * Fetches balances for all supported chains using direct HTTP calls.
 * Supports native tokens (BTC, BCH, ETH, POL, SOL) and USDC variants
 * (ERC-20 on ETH/POL, SPL on SOL).
 *
 * Cached balances are stored in wallet_addresses.cached_balance.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletChain } from './identity';

/** Truncate an address for safe logging */
function truncAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr || '';
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface BalanceResult {
  balance: string; // Human-readable amount (e.g. "1.5")
  chain: WalletChain;
  address: string;
  updatedAt: string; // ISO timestamp
}

export interface WalletBalanceSummary {
  wallet_id: string;
  balances: BalanceResult[];
  total_usd?: number;
}

// ──────────────────────────────────────────────
// RPC Endpoints
// ──────────────────────────────────────────────

function getRpcEndpoints(): Record<string, string> {
  return {
    BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
    BCH: process.env.BCH_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet',
    ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    BNB: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org',
    DOGE: process.env.DOGE_RPC_URL || 'https://dogechain.info/api/v1',
    XRP: process.env.XRP_RPC_URL || 'https://s1.ripple.com:51234',
    ADA: process.env.ADA_RPC_URL || 'https://cardano-mainnet.blockfrost.io/api/v0',
  };
}

// USDC contract addresses
const USDC_CONTRACTS: Record<string, string> = {
  USDC_ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDC_POL: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  // USDC on BNB Smart Chain
  USDC_BNB: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};

// USDT contract addresses (ERC-20 compatible)
const USDT_CONTRACTS: Record<string, string> = {
  USDT_ETH: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  USDT_BNB: '0x55d398326f99059fF775485246999027B3197955',
};

// USDC on Solana (SPL token mint)
const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// USDC/USDT have 6 decimals on all chains
const USDC_DECIMALS = 6;
const USDT_DECIMALS = 6;

// ERC-20 balanceOf(address) function selector
const BALANCE_OF_SELECTOR = '0x70a08231';

// ──────────────────────────────────────────────
// Balance Cache TTL
// ──────────────────────────────────────────────

/** Default cache TTL in seconds */
const CACHE_TTL_SECONDS = 30;

// ──────────────────────────────────────────────
// Chain-specific Balance Fetchers
// ──────────────────────────────────────────────

/**
 * Fetch BTC balance via Blockstream API.
 */
async function fetchBTCBalance(address: string): Promise<string> {
  const response = await fetch(`https://blockstream.info/api/address/${address}`);
  if (!response.ok) {
    throw new Error(`BTC balance fetch failed: ${response.status}`);
  }
  const data = await response.json();
  const satoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
  return (satoshis / 1e8).toString();
}

/**
 * Fetch BCH balance using multiple fallback APIs.
 */
async function fetchBCHBalance(address: string): Promise<string> {
  // Try Tatum first
  const tatumKey = process.env.TATUM_API_KEY;
  if (tatumKey) {
    try {
      // Tatum needs legacy format; for simplicity accept as-is (Tatum handles CashAddr)
      const resp = await fetch(`https://api.tatum.io/v3/bcash/address/balance/${address}`, {
        headers: { 'x-api-key': tatumKey },
      });
      if (resp.ok) {
        const data = await resp.json();
        const incoming = parseFloat(data.incoming || '0');
        const outgoing = parseFloat(data.outgoing || '0');
        return (incoming - outgoing).toString();
      }
    } catch (err) {
      console.error('BCH Tatum balance fetch failed, trying next provider:', err);
    }
  }

  // Try CryptoAPIs
  const cryptoKey = process.env.CRYPTO_APIS_KEY;
  if (cryptoKey) {
    try {
      let addr = address.toLowerCase();
      if (addr.startsWith('bitcoincash:')) addr = addr.substring(12);
      const resp = await fetch(
        `https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet/addresses/${addr}`,
        { headers: { 'Content-Type': 'application/json', 'X-API-Key': cryptoKey } }
      );
      if (resp.ok) {
        const data = await resp.json();
        return data.data?.item?.confirmedBalance?.amount || '0';
      }
    } catch (err) {
      console.error('BCH CryptoAPIs balance fetch failed, trying next provider:', err);
    }
  }

  // Fallback: fullstack.cash
  try {
    const resp = await fetch(`https://api.fullstack.cash/v5/electrumx/balance/${address}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.success) {
        const sats = (data.balance?.confirmed || 0) + (data.balance?.unconfirmed || 0);
        return (sats / 1e8).toString();
      }
    }
  } catch (err) {
    console.error('BCH fullstack.cash balance fetch failed:', err);
  }

  throw new Error('All BCH balance APIs failed');
}

/**
 * Fetch native EVM balance (ETH or POL) via JSON-RPC.
 */
async function fetchEVMNativeBalance(address: string, rpcUrl: string): Promise<string> {
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
    throw new Error(`EVM balance fetch failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const balanceWei = BigInt(data.result || '0x0');
  // Convert wei to ether (18 decimals) with precision
  return formatBigIntDecimal(balanceWei, 18);
}

/**
 * Fetch ERC-20 token balance via eth_call to balanceOf().
 */
async function fetchERC20Balance(
  ownerAddress: string,
  contractAddress: string,
  rpcUrl: string,
  decimals: number
): Promise<string> {
  // balanceOf(address) - pad address to 32 bytes
  const paddedAddress = ownerAddress.toLowerCase().replace('0x', '').padStart(64, '0');
  const callData = BALANCE_OF_SELECTOR + paddedAddress;

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
    throw new Error(`ERC-20 balance fetch failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const balanceRaw = BigInt(data.result || '0x0');
  return formatBigIntDecimal(balanceRaw, decimals);
}

/**
 * Fetch native SOL balance via JSON-RPC.
 */
async function fetchSOLBalance(address: string, rpcUrl: string): Promise<string> {
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
    throw new Error(`SOL balance fetch failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const lamports = data.result?.value || 0;
  return (lamports / 1e9).toString();
}

/**
 * Fetch SPL token balance on Solana (e.g. USDC).
 */
async function fetchSPLTokenBalance(
  ownerAddress: string,
  mintAddress: string,
  rpcUrl: string,
  decimals: number
): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getTokenAccountsByOwner',
      params: [
        ownerAddress,
        { mint: mintAddress },
        { encoding: 'jsonParsed' },
      ],
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`SPL token balance fetch failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const accounts = data.result?.value || [];
  if (accounts.length === 0) {
    return '0';
  }

  // Sum all token accounts for this mint
  let total = 0;
  for (const account of accounts) {
    const amount = account.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    total += amount;
  }

  return total.toString();
}

/**
 * Fetch DOGE balance via Dogechain or Blockcypher API.
 */
async function fetchDOGEBalance(address: string): Promise<string> {
  // Try Blockcypher first (more reliable)
  try {
    const resp = await fetch(`https://api.blockcypher.com/v1/doge/main/addrs/${address}/balance`);
    if (resp.ok) {
      const data = await resp.json();
      const satoshis = data.balance || 0;
      return (satoshis / 1e8).toString();
    }
  } catch (err) {
    console.error('DOGE Blockcypher balance fetch failed:', err);
  }

  // Fallback to Dogechain
  try {
    const resp = await fetch(`https://dogechain.info/api/v1/address/balance/${address}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.success === 1) {
        return data.balance || '0';
      }
    }
  } catch (err) {
    console.error('DOGE Dogechain balance fetch failed:', err);
  }

  throw new Error('All DOGE balance APIs failed');
}

/**
 * Fetch BNB (BSC) native balance via JSON-RPC.
 */
async function fetchBNBBalance(address: string, rpcUrl: string): Promise<string> {
  return fetchEVMNativeBalance(address, rpcUrl);
}

/**
 * Fetch XRP balance via Ripple JSON-RPC.
 */
async function fetchXRPBalance(address: string, rpcUrl: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'account_info',
      params: [{
        account: address,
        ledger_index: 'validated',
      }],
    }),
  });

  if (!response.ok) {
    throw new Error(`XRP balance fetch failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.result?.error === 'actNotFound') {
    return '0'; // Account not activated
  }
  if (data.result?.error) {
    throw new Error(`XRP RPC error: ${data.result.error}`);
  }

  // XRP balance is in drops (1 XRP = 1,000,000 drops)
  const drops = BigInt(data.result?.account_data?.Balance || '0');
  return formatBigIntDecimal(drops, 6);
}

/**
 * Fetch ADA balance via Blockfrost API.
 */
async function fetchADABalance(address: string): Promise<string> {
  const blockfrostKey = process.env.BLOCKFROST_API_KEY;
  if (!blockfrostKey) {
    throw new Error('BLOCKFROST_API_KEY is required for ADA balance');
  }

  const response = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}`, {
    headers: { 'project_id': blockfrostKey },
  });

  if (response.status === 404) {
    return '0'; // Address not used yet
  }

  if (!response.ok) {
    throw new Error(`ADA balance fetch failed: ${response.status}`);
  }

  const data = await response.json();
  // ADA is in lovelace (1 ADA = 1,000,000 lovelace)
  // Find lovelace entry specifically (not native tokens)
  const lovelaceEntry = data.amount?.find((a: { unit: string }) => a.unit === 'lovelace');
  const lovelace = BigInt(lovelaceEntry?.quantity || '0');
  return formatBigIntDecimal(lovelace, 6);
}

// ──────────────────────────────────────────────
// Unified Balance Fetcher
// ──────────────────────────────────────────────

/**
 * Fetch the live balance for a given address and chain.
 * Makes a direct API/RPC call — no caching.
 */
export async function fetchBalance(address: string, chain: WalletChain): Promise<string> {
  console.log(`[Balance] Fetching live balance for ${chain} address ${truncAddr(address)}`);
  const rpc = getRpcEndpoints();

  switch (chain) {
    // Native coins
    case 'BTC':
      return fetchBTCBalance(address);
    case 'BCH':
      return fetchBCHBalance(address);
    case 'ETH':
      return fetchEVMNativeBalance(address, rpc.ETH);
    case 'POL':
      return fetchEVMNativeBalance(address, rpc.POL);
    case 'SOL':
      return fetchSOLBalance(address, rpc.SOL);
    case 'BNB':
      return fetchBNBBalance(address, rpc.BNB);
    case 'DOGE':
      return fetchDOGEBalance(address);
    case 'XRP':
      return fetchXRPBalance(address, rpc.XRP);
    case 'ADA':
      return fetchADABalance(address);

    // USDC variants
    case 'USDC':
    case 'USDC_ETH':
      return fetchERC20Balance(address, USDC_CONTRACTS.USDC_ETH, rpc.ETH, USDC_DECIMALS);
    case 'USDC_POL':
      return fetchERC20Balance(address, USDC_CONTRACTS.USDC_POL, rpc.POL, USDC_DECIMALS);
    case 'USDC_SOL':
      return fetchSPLTokenBalance(address, USDC_SOL_MINT, rpc.SOL, USDC_DECIMALS);

    // USDT (defaults to ETH)
    case 'USDT':
      return fetchERC20Balance(address, USDT_CONTRACTS.USDT_ETH, rpc.ETH, USDT_DECIMALS);

    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

// ──────────────────────────────────────────────
// Cached Balance Operations
// ──────────────────────────────────────────────

/**
 * Get the cached balance for a single address. If the cache is stale
 * (older than TTL), fetches fresh and updates the cache.
 */
export async function getAddressBalance(
  supabase: SupabaseClient,
  walletId: string,
  addressId: string,
  forceRefresh = false
): Promise<{ success: true; data: BalanceResult } | { success: false; error: string; code?: string }> {
  // Fetch the address record
  const { data: addr, error } = await supabase
    .from('wallet_addresses')
    .select('id, wallet_id, chain, address, cached_balance, cached_balance_updated_at')
    .eq('id', addressId)
    .eq('wallet_id', walletId)
    .single();

  if (error || !addr) {
    console.error(`[Balance] Address ${addressId} not found for wallet ${walletId}`);
    return { success: false, error: 'Address not found', code: 'ADDRESS_NOT_FOUND' };
  }

  // Check if cache is fresh enough
  const now = Date.now();
  const cachedAt = addr.cached_balance_updated_at
    ? new Date(addr.cached_balance_updated_at).getTime()
    : 0;
  const isFresh = !forceRefresh && (now - cachedAt < CACHE_TTL_SECONDS * 1000);

  if (isFresh && addr.cached_balance !== null) {
    console.log(`[Balance] Cache hit for ${addr.chain} ${truncAddr(addr.address)}: ${addr.cached_balance}`);
    return {
      success: true,
      data: {
        balance: addr.cached_balance.toString(),
        chain: addr.chain as WalletChain,
        address: addr.address,
        updatedAt: addr.cached_balance_updated_at,
      },
    };
  }

  // Fetch fresh balance
  try {
    const balance = await fetchBalance(addr.address, addr.chain as WalletChain);
    const updatedAt = new Date().toISOString();

    console.log(`[Balance] Fetched ${addr.chain} ${truncAddr(addr.address)}: ${balance}`);

    // Update cache in DB
    await supabase
      .from('wallet_addresses')
      .update({
        cached_balance: parseFloat(balance),
        cached_balance_updated_at: updatedAt,
      })
      .eq('id', addressId);

    return {
      success: true,
      data: {
        balance,
        chain: addr.chain as WalletChain,
        address: addr.address,
        updatedAt,
      },
    };
  } catch (fetchError: any) {
    // If fetch fails and we have a stale cache, return it
    if (addr.cached_balance !== null) {
      return {
        success: true,
        data: {
          balance: addr.cached_balance.toString(),
          chain: addr.chain as WalletChain,
          address: addr.address,
          updatedAt: addr.cached_balance_updated_at || new Date().toISOString(),
        },
      };
    }
    console.error(`[Balance] Fetch failed for ${addr.chain} ${truncAddr(addr.address)}: ${fetchError.message}`);
    return { success: false, error: `Balance fetch failed: ${fetchError.message}`, code: 'FETCH_ERROR' };
  }
}

/**
 * Get all balances for a wallet. Returns cached balances and refreshes
 * stale ones in the background.
 */
export async function getWalletBalances(
  supabase: SupabaseClient,
  walletId: string,
  options: { chain?: string; forceRefresh?: boolean } = {}
): Promise<{ success: true; data: BalanceResult[] } | { success: false; error: string; code?: string }> {
  // Build query
  let query = supabase
    .from('wallet_addresses')
    .select('id, wallet_id, chain, address, cached_balance, cached_balance_updated_at, is_active')
    .eq('wallet_id', walletId)
    .eq('is_active', true);

  if (options.chain) {
    query = query.eq('chain', options.chain);
  }

  const { data: addresses, error } = await query;

  if (error) {
    return { success: false, error: 'Failed to load addresses', code: 'DB_ERROR' };
  }

  if (!addresses || addresses.length === 0) {
    return { success: true, data: [] };
  }

  console.log(`[Balance] Fetching balances for wallet ${walletId}: ${addresses.length} addresses${options.chain ? ` (chain=${options.chain})` : ''}`);

  const now = Date.now();
  const results: BalanceResult[] = [];
  const refreshPromises: Promise<void>[] = [];

  for (const addr of addresses) {
    const cachedAt = addr.cached_balance_updated_at
      ? new Date(addr.cached_balance_updated_at).getTime()
      : 0;
    const isFresh = !options.forceRefresh && (now - cachedAt < CACHE_TTL_SECONDS * 1000);

    if (isFresh && addr.cached_balance !== null) {
      results.push({
        balance: addr.cached_balance.toString(),
        chain: addr.chain as WalletChain,
        address: addr.address,
        updatedAt: addr.cached_balance_updated_at,
      });
    } else {
      // Return stale value immediately, refresh in background
      results.push({
        balance: (addr.cached_balance ?? 0).toString(),
        chain: addr.chain as WalletChain,
        address: addr.address,
        updatedAt: addr.cached_balance_updated_at || new Date().toISOString(),
      });

      // Queue a refresh
      refreshPromises.push(
        fetchBalance(addr.address, addr.chain as WalletChain)
          .then(async (balance) => {
            const updatedAt = new Date().toISOString();
            await supabase
              .from('wallet_addresses')
              .update({
                cached_balance: parseFloat(balance),
                cached_balance_updated_at: updatedAt,
              })
              .eq('id', addr.id);

            // Update the result in place
            const idx = results.findIndex(
              (r) => r.address === addr.address && r.chain === addr.chain
            );
            if (idx >= 0) {
              results[idx].balance = balance;
              results[idx].updatedAt = updatedAt;
            }
          })
          .catch(() => {
            // Silently keep stale balance on fetch failure
          })
      );
    }
  }

  // Wait for all refreshes (with timeout)
  if (refreshPromises.length > 0) {
    console.log(`[Balance] Refreshing ${refreshPromises.length} stale balances for wallet ${walletId}`);
    await Promise.allSettled(refreshPromises);
  }

  return { success: true, data: results };
}

/**
 * Refresh all balances for active addresses on a given chain.
 * Used by the polling scheduler.
 */
export async function refreshChainBalances(
  supabase: SupabaseClient,
  chain: WalletChain
): Promise<{ updated: number; errors: number }> {
  const { data: addresses, error } = await supabase
    .from('wallet_addresses')
    .select('id, address, chain')
    .eq('chain', chain)
    .eq('is_active', true);

  if (error || !addresses) {
    console.error(`[Balance] refreshChainBalances: failed to load ${chain} addresses`);
    return { updated: 0, errors: 0 };
  }

  console.log(`[Balance] Refreshing ${addresses.length} ${chain} addresses`);

  let updated = 0;
  let errors = 0;

  // Process in batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (addr) => {
        const balance = await fetchBalance(addr.address, addr.chain as WalletChain);
        const updatedAt = new Date().toISOString();
        await supabase
          .from('wallet_addresses')
          .update({
            cached_balance: parseFloat(balance),
            cached_balance_updated_at: updatedAt,
          })
          .eq('id', addr.id);
        return balance;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') updated++;
      else errors++;
    }
  }

  return { updated, errors };
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

/**
 * Format a bigint with the given number of decimals into a human-readable string.
 */
function formatBigIntDecimal(value: bigint, decimals: number): string {
  if (value === 0n) return '0';

  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;

  if (remainder === 0n) return whole.toString();

  // Pad remainder to correct number of decimal places
  const remainderStr = remainder.toString().padStart(decimals, '0');
  // Remove trailing zeros
  const trimmed = remainderStr.replace(/0+$/, '');
  return `${whole}.${trimmed}`;
}

// Export for testing
export { formatBigIntDecimal as _formatBigIntDecimal };
export { CACHE_TTL_SECONDS };
