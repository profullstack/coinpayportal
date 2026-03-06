/**
 * Blockchain Balance Checking
 *
 * Shared balance-checking utilities used by the payment monitor.
 */

// RPC endpoints for different blockchains
const RPC_ENDPOINTS: Record<string, string> = {
  BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
  BCH: process.env.BCH_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet',
  ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  BNB: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org',
  XRP: process.env.XRP_RPC_URL || 'https://s1.ripple.com:51234',
};

const CRYPTO_APIS_KEY = process.env.CRYPTO_APIS_KEY || '';


// Drain response body to prevent socket/memory leaks on error responses
async function drainResponse(res: Response): Promise<void> {
  try { await res.text(); } catch { /* ignore */ }
}

export interface Payment {
  id: string;
  business_id: string;
  blockchain: string;
  crypto_amount: number;
  status: string;
  payment_address: string;
  created_at: string;
  expires_at: string;
  merchant_wallet_address: string;
}

export interface BalanceResult {
  balance: number;
  txHash?: string;
}

/**
 * Check balance for a Bitcoin address
 */
async function checkBitcoinBalance(address: string): Promise<BalanceResult> {
  try {
    const response = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!response.ok) {
      await drainResponse(response);
      return { balance: 0 };
    }
    
    const data = await response.json();
    const balanceSatoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
    const balance = balanceSatoshis / 100_000_000;
    
    // Get the latest transaction hash if there's a balance
    let txHash: string | undefined;
    if (balance > 0) {
      try {
        const txResponse = await fetch(`https://blockstream.info/api/address/${address}/txs`);
        if (txResponse.ok) {
          const txs = await txResponse.json();
          if (txs && txs.length > 0) {
            txHash = txs[0].txid;
            console.log(`[Monitor] BTC tx hash for ${address}: ${txHash}`);
          }
        }
      } catch (txError) {
        console.error(`[Monitor] Error fetching BTC transactions for ${address}:`, txError);
      }
    }
    
    return { balance, txHash };
  } catch (error) {
    console.error(`[Monitor] Error checking BTC balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a Bitcoin Cash address
 */
async function checkBCHBalance(address: string): Promise<BalanceResult> {
  try {
    if (!CRYPTO_APIS_KEY) {
      console.error('[Monitor] CRYPTO_APIS_KEY not configured for BCH');
      return { balance: 0 };
    }
    const url = `https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet/addresses/${address}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CRYPTO_APIS_KEY,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Monitor] Failed to fetch BCH balance for ${address}: ${response.status} - ${errorText}`);
      return { balance: 0 };
    }
    
    const data = await response.json();
    const balance = parseFloat(data.data?.item?.confirmedBalance?.amount || '0');
    
    // Get the latest transaction hash if there's a balance
    let txHash: string | undefined;
    if (balance > 0) {
      try {
        const txUrl = `https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet/addresses/${address}/transactions`;
        const txResponse = await fetch(txUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': CRYPTO_APIS_KEY,
          },
        });
        if (txResponse.ok) {
          const txData = await txResponse.json();
          if (txData.data?.items && txData.data.items.length > 0) {
            txHash = txData.data.items[0].transactionId;
            console.log(`[Monitor] BCH tx hash for ${address}: ${txHash}`);
          }
        }
      } catch (txError) {
        console.error(`[Monitor] Error fetching BCH transactions for ${address}:`, txError);
      }
    }
    
    return { balance, txHash };
  } catch (error) {
    console.error(`[Monitor] Error checking BCH balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for an EVM address (ETH/POL)
 */
async function checkEVMBalance(address: string, rpcUrl: string, chain: string): Promise<BalanceResult> {
  try {
    console.log(`[Monitor] Checking ${chain} balance for ${address}`);
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
      await drainResponse(response);
      return { balance: 0 };
    }
    
    const data = await response.json();
    if (data.error) {
      console.error(`[Monitor] RPC error for ${address}:`, data.error);
      return { balance: 0 };
    }
    
    const balanceWei = BigInt(data.result || '0x0');
    const balance = Number(balanceWei) / 1e18;
    console.log(`[Monitor] ${chain} balance for ${address}: ${balance}`);
    
    // For EVM chains, we need to use an explorer API to get tx hash
    // This is a simplified version - in production you'd use Etherscan/Polygonscan API
    let txHash: string | undefined;
    if (balance > 0) {
      // Try to get the latest transaction using eth_getBlockByNumber and filtering
      // For now, we'll leave this as undefined and let the forwarding process set it
      // A proper implementation would use Etherscan/Polygonscan API
      console.log(`[Monitor] ${chain} tx hash lookup not implemented - will be set during forwarding`);
    }
    
    return { balance, txHash };
  } catch (error) {
    console.error(`[Monitor] Error checking ${chain} balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a Solana address
 */
async function checkSolanaBalance(address: string, rpcUrl: string): Promise<BalanceResult> {
  try {
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
      console.error(`[Monitor] Failed to fetch SOL balance for ${address}: ${response.status} - ${errorText}`);
      return { balance: 0 };
    }
    
    const data = await response.json();
    if (data.error) {
      console.error(`[Monitor] RPC error for ${address}:`, data.error);
      return { balance: 0 };
    }
    
    const balanceLamports = data.result?.value || 0;
    const balance = balanceLamports / 1e9;
    
    // Get the latest transaction signature if there's a balance
    let txHash: string | undefined;
    if (balance > 0) {
      try {
        const sigResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'getSignaturesForAddress',
            params: [address, { limit: 1 }],
            id: 1,
          }),
        });
        
        if (sigResponse.ok) {
          const sigData = await sigResponse.json();
          if (sigData.result && sigData.result.length > 0) {
            txHash = sigData.result[0].signature;
            console.log(`[Monitor] SOL tx hash for ${address}: ${txHash}`);
          }
        }
      } catch (txError) {
        console.error(`[Monitor] Error fetching SOL transactions for ${address}:`, txError);
      }
    }
    
    return { balance, txHash };
  } catch (error) {
    console.error(`[Monitor] Error checking SOL balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a Dogecoin address
 */
async function checkDOGEBalance(address: string): Promise<BalanceResult> {
  try {
    // Try Blockcypher first
    const response = await fetch(`https://api.blockcypher.com/v1/doge/main/addrs/${address}/balance`);
    if (response.ok) {
      const data = await response.json();
      const balance = (data.balance || 0) / 1e8;
      return { balance };
    }
    // Fallback to dogechain
    const fallbackResponse = await fetch(`https://dogechain.info/api/v1/address/balance/${address}`);
    if (fallbackResponse.ok) {
      const data = await fallbackResponse.json();
      if (data.success === 1) {
        const balance = parseFloat(data.balance || '0');
        return { balance };
      }
    }
    return { balance: 0 };
  } catch (error) {
    console.error(`[Monitor] Error checking DOGE balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a BNB (BSC) address
 */
async function checkBNBBalance(address: string): Promise<BalanceResult> {
  try {
    const response = await fetch(RPC_ENDPOINTS.BNB, {
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
      return { balance: 0 };
    }
    const data = await response.json();
    const balanceWei = BigInt(data.result || '0x0');
    const balance = Number(balanceWei) / 1e18;
    return { balance };
  } catch (error) {
    console.error(`[Monitor] Error checking BNB balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for an XRP address
 */
async function checkXRPBalance(address: string): Promise<BalanceResult> {
  try {
    const response = await fetch(RPC_ENDPOINTS.XRP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_info',
        params: [{ account: address, ledger_index: 'validated' }],
      }),
    });
    if (!response.ok) {
      return { balance: 0 };
    }
    const data = await response.json();
    if (data.result?.error === 'actNotFound') {
      return { balance: 0 }; // Account not activated
    }
    // XRP balance is in drops (1 XRP = 1,000,000 drops)
    const drops = BigInt(data.result?.account_data?.Balance || '0');
    const balance = Number(drops) / 1e6;
    return { balance };
  } catch (error) {
    console.error(`[Monitor] Error checking XRP balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a Cardano (ADA) address
 */
async function checkADABalance(address: string): Promise<BalanceResult> {
  try {
    const blockfrostKey = process.env.BLOCKFROST_API_KEY;
    if (!blockfrostKey) {
      console.error('[Monitor] BLOCKFROST_API_KEY not configured for ADA');
      return { balance: 0 };
    }
    const response = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}`, {
      headers: { 'project_id': blockfrostKey },
    });
    if (response.status === 404) {
      return { balance: 0 }; // Address not used yet
    }
    if (!response.ok) {
      return { balance: 0 };
    }
    const data = await response.json();
    // ADA is in lovelace (1 ADA = 1,000,000 lovelace)
    // Find lovelace entry specifically (not native tokens)
    const lovelaceEntry = data.amount?.find((a: { unit: string }) => a.unit === 'lovelace');
    const lovelace = BigInt(lovelaceEntry?.quantity || '0');
    const balance = Number(lovelace) / 1e6;
    return { balance };
  } catch (error) {
    console.error(`[Monitor] Error checking ADA balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for any supported blockchain
 */
export async function checkBalance(address: string, blockchain: string): Promise<BalanceResult> {
  switch (blockchain) {
    case 'BTC':
      return checkBitcoinBalance(address);
    case 'BCH':
      return checkBCHBalance(address);
    case 'ETH':
    case 'USDT':
    case 'USDC':
    case 'USDC_ETH':
      return checkEVMBalance(address, RPC_ENDPOINTS.ETH, 'ETH');
    case 'POL':
    case 'USDC_POL':
      return checkEVMBalance(address, RPC_ENDPOINTS.POL, 'POL');
    case 'SOL':
    case 'USDC_SOL':
      return checkSolanaBalance(address, RPC_ENDPOINTS.SOL);
    case 'BNB':
      return checkBNBBalance(address);
    case 'DOGE':
      return checkDOGEBalance(address);
    case 'XRP':
      return checkXRPBalance(address);
    case 'ADA':
      return checkADABalance(address);
    default:
      console.error(`[Monitor] Unsupported blockchain: ${blockchain}`);
      return { balance: 0 };
  }
}

/**
 * Process a single payment - check balance and update status
 */
export async function processPayment(supabase: any, payment: Payment): Promise<{ confirmed: boolean; expired: boolean }> {
  const now = new Date();
  
  // Check if payment has expired
  const expiresAt = new Date(payment.expires_at);
  if (now > expiresAt) {
    console.log(`[Monitor] Payment ${payment.id} expired`);
    await supabase
      .from('payments')
      .update({
        status: 'expired',
        updated_at: now.toISOString(),
      })
      .eq('id', payment.id);
    return { confirmed: false, expired: true };
  }
  
  // Check if we have a payment address
  if (!payment.payment_address) {
    console.log(`[Monitor] Payment ${payment.id} has no address`);
    return { confirmed: false, expired: false };
  }
  
  // Check blockchain balance
  const balanceResult = await checkBalance(payment.payment_address, payment.blockchain);
  console.log(`[Monitor] Payment ${payment.id}: balance=${balanceResult.balance}, expected=${payment.crypto_amount}, txHash=${balanceResult.txHash || 'none'}`);
  
  // Check if sufficient funds received (1% tolerance)
  const tolerance = payment.crypto_amount * 0.01;
  if (balanceResult.balance >= payment.crypto_amount - tolerance) {
    console.log(`[Monitor] Payment ${payment.id} CONFIRMED with balance ${balanceResult.balance}`);
    
    // Mark as confirmed and store tx_hash if available
    const updateData: Record<string, any> = {
      status: 'confirmed',
      updated_at: now.toISOString(),
      confirmed_at: now.toISOString(),
    };
    
    if (balanceResult.txHash) {
      updateData.tx_hash = balanceResult.txHash;
    }
    
    await supabase
      .from('payments')
      .update(updateData)
      .eq('id', payment.id);
    
    // Trigger forwarding
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const internalApiKey = process.env.INTERNAL_API_KEY;
    
    if (internalApiKey) {
      try {
        console.log(`[Monitor] Triggering forwarding for payment ${payment.id}`);
        const forwardResponse = await fetch(`${appUrl}/api/payments/${payment.id}/forward`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${internalApiKey}`,
          },
        });
        
        if (!forwardResponse.ok) {
          const errorText = await forwardResponse.text();
          console.error(`[Monitor] Failed to trigger forwarding for ${payment.id}: ${forwardResponse.status} - ${errorText}`);
        } else {
          const forwardResult = await forwardResponse.json();
          console.log(`[Monitor] Forwarding completed for payment ${payment.id}:`, JSON.stringify(forwardResult));
        }
      } catch (forwardError) {
        console.error(`[Monitor] Error triggering forwarding for ${payment.id}:`, forwardError);
      }
    } else {
      console.warn(`[Monitor] INTERNAL_API_KEY not configured - cannot trigger forwarding for ${payment.id}`);
    }
    
    return { confirmed: true, expired: false };
  }
  
  return { confirmed: false, expired: false };
}

