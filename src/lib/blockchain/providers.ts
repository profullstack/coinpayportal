import { ethers } from 'ethers';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction as SolanaTransaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';

/**
 * Supported blockchain types
 */
export type BlockchainType = 'BTC' | 'BCH' | 'ETH' | 'MATIC' | 'SOL';

/**
 * Transaction details interface
 */
export interface TransactionDetails {
  hash: string;
  from: string;
  to: string;
  value: string;
  confirmations: number;
  blockNumber?: number;
  timestamp?: number;
  status?: 'pending' | 'confirmed' | 'failed';
}

/**
 * Base blockchain provider interface
 */
export interface BlockchainProvider {
  chain: BlockchainType;
  rpcUrl: string;
  getBalance(address: string): Promise<string>;
  getTransaction(txHash: string): Promise<TransactionDetails>;
  getRequiredConfirmations(): number;
  sendTransaction?(from: string, to: string, amount: string, privateKey: string): Promise<string>;
}

/**
 * Bitcoin provider implementation
 */
export class BitcoinProvider implements BlockchainProvider {
  chain: BlockchainType = 'BTC';
  rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  async getBalance(address: string): Promise<string> {
    try {
      // Use blockchain.info API for Bitcoin balance
      const response = await axios.get(
        `https://blockchain.info/q/addressbalance/${address}`
      );
      // Convert satoshis to BTC
      return (Number(response.data) / 100000000).toString();
    } catch (error) {
      console.error('Error fetching Bitcoin balance:', error);
      return '0';
    }
  }

  async getTransaction(txHash: string): Promise<TransactionDetails> {
    try {
      const response = await axios.get(
        `https://blockchain.info/rawtx/${txHash}`
      );
      const tx = response.data;

      return {
        hash: tx.hash,
        from: tx.inputs[0]?.prev_out?.addr || '',
        to: tx.out[0]?.addr || '',
        value: (tx.out[0]?.value / 100000000).toString(),
        confirmations: tx.block_height ? 1 : 0,
        blockNumber: tx.block_height,
        timestamp: tx.time,
        status: tx.block_height ? 'confirmed' : 'pending',
      };
    } catch (error) {
      throw new Error(`Failed to fetch Bitcoin transaction: ${error}`);
    }
  }

  getRequiredConfirmations(): number {
    return 3;
  }
}

/**
 * Ethereum provider implementation
 */
export class EthereumProvider implements BlockchainProvider {
  chain: BlockchainType = 'ETH';
  rpcUrl: string;
  private provider: ethers.JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async getBalance(address: string): Promise<string> {
    try {
      const balance = await this.provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error('Error fetching Ethereum balance:', error);
      return '0';
    }
  }

  async getTransaction(txHash: string): Promise<TransactionDetails> {
    try {
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) {
        throw new Error('Transaction not found');
      }

      const receipt = await this.provider.getTransactionReceipt(txHash);
      const currentBlock = await this.provider.getBlockNumber();
      const confirmations = receipt
        ? currentBlock - receipt.blockNumber + 1
        : 0;

      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        value: ethers.formatEther(tx.value),
        confirmations,
        blockNumber: receipt?.blockNumber,
        status: receipt
          ? receipt.status === 1
            ? 'confirmed'
            : 'failed'
          : 'pending',
      };
    } catch (error) {
      throw new Error(`Failed to fetch Ethereum transaction: ${error}`);
    }
  }

  async estimateGas(from: string, to: string, value: string): Promise<string> {
    try {
      const gasEstimate = await this.provider.estimateGas({
        from,
        to,
        value: ethers.parseEther(value),
      });
      return gasEstimate.toString();
    } catch (error) {
      console.error('Error estimating gas:', error);
      return '21000'; // Default gas limit for simple transfers
    }
  }

  async sendTransaction(
    from: string,
    to: string,
    amount: string,
    privateKey: string
  ): Promise<string> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider);
      
      // Get current balance and gas price to calculate max sendable
      const balance = await this.provider.getBalance(wallet.address);
      const feeData = await this.provider.getFeeData();
      const gasLimit = BigInt(21000); // Standard ETH transfer gas limit
      const gasPrice = feeData.gasPrice || BigInt(20000000000); // 20 gwei fallback
      const gasCost = gasLimit * gasPrice;
      
      let valueToSend = ethers.parseEther(amount);
      
      console.log(`[ETH] Balance: ${ethers.formatEther(balance)} ETH, requested: ${amount} ETH, gas cost: ${ethers.formatEther(gasCost)} ETH`);
      
      // If requested amount + gas exceeds balance, adjust to send max possible
      if (valueToSend + gasCost > balance) {
        const maxSendable = balance - gasCost;
        if (maxSendable <= BigInt(0)) {
          throw new Error(`Insufficient balance. Have ${ethers.formatEther(balance)} ETH, need at least ${ethers.formatEther(gasCost)} ETH for gas`);
        }
        console.log(`[ETH] Adjusting amount from ${amount} to ${ethers.formatEther(maxSendable)} ETH (max sendable after gas)`);
        valueToSend = maxSendable;
      }
      
      const tx = await wallet.sendTransaction({
        to,
        value: valueToSend,
        gasLimit,
        gasPrice,
      });
      await tx.wait();
      console.log(`[ETH] Transaction sent: ${tx.hash}`);
      return tx.hash;
    } catch (error) {
      console.error('[ETH] Transaction failed:', error);
      throw new Error(`Failed to send Ethereum transaction: ${error}`);
    }
  }

  /**
   * Send split transaction to multiple recipients
   * For EVM chains, we need to send separate transactions but account for gas
   */
  async sendSplitTransaction(
    from: string,
    recipients: Array<{ address: string; amount: string }>,
    privateKey: string
  ): Promise<string> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider);
      
      // Get current balance and gas price
      const balance = await this.provider.getBalance(wallet.address);
      const feeData = await this.provider.getFeeData();
      const gasLimit = BigInt(21000);
      const gasPrice = feeData.gasPrice || BigInt(20000000000);
      const gasCostPerTx = gasLimit * gasPrice;
      const totalGasCost = gasCostPerTx * BigInt(recipients.length);
      
      // Calculate total requested
      let totalRequested = BigInt(0);
      for (const recipient of recipients) {
        totalRequested += ethers.parseEther(recipient.amount);
      }
      
      console.log(`[ETH] Split: balance=${ethers.formatEther(balance)}, total=${ethers.formatEther(totalRequested)}, gas=${ethers.formatEther(totalGasCost)}`);
      
      // Calculate amounts to send (proportionally reduced if needed)
      const availableForTransfers = balance - totalGasCost;
      if (availableForTransfers <= BigInt(0)) {
        throw new Error(`Insufficient balance for split transaction`);
      }
      
      let ratio = BigInt(1000000); // Use fixed point math (1.0 = 1000000)
      if (totalRequested > availableForTransfers) {
        ratio = (availableForTransfers * BigInt(1000000)) / totalRequested;
        console.log(`[ETH] Adjusting split amounts by ratio ${Number(ratio) / 1000000}`);
      }
      
      const txHashes: string[] = [];
      
      for (const recipient of recipients) {
        let valueToSend = ethers.parseEther(recipient.amount);
        if (ratio < BigInt(1000000)) {
          valueToSend = (valueToSend * ratio) / BigInt(1000000);
        }
        
        if (valueToSend > BigInt(0)) {
          const tx = await wallet.sendTransaction({
            to: recipient.address,
            value: valueToSend,
            gasLimit,
            gasPrice,
          });
          await tx.wait();
          txHashes.push(tx.hash);
          console.log(`[ETH] Split tx sent to ${recipient.address}: ${tx.hash}`);
        }
      }
      
      // Return first tx hash (or combined)
      return txHashes[0] || '';
    } catch (error) {
      console.error('[ETH] Split transaction failed:', error);
      throw new Error(`Failed to send Ethereum split transaction: ${error}`);
    }
  }

  getRequiredConfirmations(): number {
    return 12;
  }
}

/**
 * Polygon provider implementation (extends Ethereum)
 */
export class PolygonProvider extends EthereumProvider {
  chain: BlockchainType = 'MATIC';

  constructor(rpcUrl: string) {
    super(rpcUrl);
  }

  getRequiredConfirmations(): number {
    return 128;
  }
}

/**
 * Solana provider implementation
 */
export class SolanaProvider implements BlockchainProvider {
  chain: BlockchainType = 'SOL';
  rpcUrl: string;
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async getBalance(address: string): Promise<string> {
    try {
      const publicKey = new PublicKey(address);
      const balance = await this.connection.getBalance(publicKey);
      // Convert lamports to SOL
      return (balance / 1000000000).toString();
    } catch (error) {
      console.error('Error fetching Solana balance:', error);
      return '0';
    }
  }

  async getTransaction(txHash: string): Promise<TransactionDetails> {
    try {
      const tx = await this.connection.getTransaction(txHash, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        throw new Error('Transaction not found');
      }

      const currentSlot = await this.connection.getSlot();
      const confirmations = tx.slot ? currentSlot - tx.slot : 0;

      // Get account keys from the transaction message
      const accountKeys = tx.transaction.message.getAccountKeys();
      
      return {
        hash: txHash,
        from: accountKeys.get(0)?.toString() || '',
        to: accountKeys.get(1)?.toString() || '',
        value: '0', // Solana transactions are more complex
        confirmations,
        blockNumber: tx.slot,
        timestamp: tx.blockTime || undefined,
        status: tx.meta?.err ? 'failed' : 'confirmed',
      };
    } catch (error) {
      throw new Error(`Failed to fetch Solana transaction: ${error}`);
    }
  }

  /**
   * Solana transaction fee in lamports (approximately 5000 lamports = 0.000005 SOL)
   * We use a slightly higher estimate to be safe
   */
  private static readonly SOLANA_TX_FEE_LAMPORTS = 5000;

  async sendTransaction(
    from: string,
    to: string,
    amount: string,
    privateKey: string
  ): Promise<string> {
    try {
      // The private key can be in different formats:
      // 1. Base58 encoded 64-byte secret key (full keypair)
      // 2. Hex encoded 64-byte secret key (full keypair)
      // 3. Hex encoded 32-byte seed (need to derive public key)
      let secretKey: Uint8Array;
      
      try {
        // Try base58 first (common Solana format for full keypair)
        const decoded = bs58.decode(privateKey);
        if (decoded.length === 64) {
          secretKey = decoded;
        } else if (decoded.length === 32) {
          // It's a 32-byte seed, need to derive the full keypair
          secretKey = await this.deriveFullKeypair(decoded);
        } else {
          throw new Error(`Invalid key length: ${decoded.length}`);
        }
      } catch {
        // Fall back to hex format
        const hexBytes = Buffer.from(privateKey, 'hex');
        if (hexBytes.length === 64) {
          secretKey = Uint8Array.from(hexBytes);
        } else if (hexBytes.length === 32) {
          // It's a 32-byte seed, need to derive the full keypair
          secretKey = await this.deriveFullKeypair(Uint8Array.from(hexBytes));
        } else {
          throw new Error(`Invalid hex key length: ${hexBytes.length}`);
        }
      }

      // Create keypair from secret key
      const keypair = Keypair.fromSecretKey(secretKey);

      // Verify the from address matches the keypair
      if (keypair.publicKey.toString() !== from) {
        console.log(`[SOL] Address mismatch: expected ${from}, got ${keypair.publicKey.toString()}`);
        // Don't throw - the address derivation might differ slightly
        // Just log and continue
      }

      // Convert amount to lamports
      let lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

      // Get current balance to check if we need to adjust for rent
      const currentBalance = await this.connection.getBalance(keypair.publicKey);
      const txFee = SolanaProvider.SOLANA_TX_FEE_LAMPORTS;
      
      console.log(`[SOL] Current balance: ${currentBalance} lamports, requested: ${lamports} lamports, tx fee: ${txFee} lamports`);

      // If we're trying to send more than balance - fee, adjust to send max possible
      // This handles the "insufficient funds for rent" error by sending everything minus fee
      if (lamports + txFee > currentBalance) {
        const maxSendable = currentBalance - txFee;
        if (maxSendable <= 0) {
          throw new Error(`Insufficient balance. Have ${currentBalance} lamports, need at least ${txFee + 1} lamports`);
        }
        console.log(`[SOL] Adjusting amount from ${lamports} to ${maxSendable} lamports (max sendable after fee)`);
        lamports = maxSendable;
      }

      // Create the transfer instruction
      const transaction = new SolanaTransaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(to),
          lamports,
        })
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;

      // Sign and send the transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [keypair],
        {
          commitment: 'confirmed',
        }
      );

      console.log(`[SOL] Transaction sent: ${signature}`);
      return signature;
    } catch (error) {
      console.error('[SOL] Transaction failed:', error);
      throw new Error(`Failed to send Solana transaction: ${error}`);
    }
  }

  /**
   * Send multiple transfers in a single transaction (more efficient for splits)
   * This is useful for payment forwarding where we need to send to merchant and platform
   */
  async sendSplitTransaction(
    from: string,
    recipients: Array<{ address: string; amount: string }>,
    privateKey: string
  ): Promise<string> {
    try {
      // Parse private key (same logic as sendTransaction)
      let secretKey: Uint8Array;
      
      try {
        const decoded = bs58.decode(privateKey);
        if (decoded.length === 64) {
          secretKey = decoded;
        } else if (decoded.length === 32) {
          secretKey = await this.deriveFullKeypair(decoded);
        } else {
          throw new Error(`Invalid key length: ${decoded.length}`);
        }
      } catch {
        const hexBytes = Buffer.from(privateKey, 'hex');
        if (hexBytes.length === 64) {
          secretKey = Uint8Array.from(hexBytes);
        } else if (hexBytes.length === 32) {
          secretKey = await this.deriveFullKeypair(Uint8Array.from(hexBytes));
        } else {
          throw new Error(`Invalid hex key length: ${hexBytes.length}`);
        }
      }

      const keypair = Keypair.fromSecretKey(secretKey);

      // Get current balance
      const currentBalance = await this.connection.getBalance(keypair.publicKey);
      const txFee = SolanaProvider.SOLANA_TX_FEE_LAMPORTS;

      // Calculate total requested
      let totalLamports = 0;
      const transfers: Array<{ address: string; lamports: number }> = [];
      
      for (const recipient of recipients) {
        const lamports = Math.floor(parseFloat(recipient.amount) * LAMPORTS_PER_SOL);
        totalLamports += lamports;
        transfers.push({ address: recipient.address, lamports });
      }

      console.log(`[SOL] Split transaction: balance=${currentBalance}, total=${totalLamports}, fee=${txFee}`);

      // If total + fee exceeds balance, proportionally reduce amounts
      if (totalLamports + txFee > currentBalance) {
        const availableForTransfers = currentBalance - txFee;
        if (availableForTransfers <= 0) {
          throw new Error(`Insufficient balance for split transaction`);
        }
        
        const ratio = availableForTransfers / totalLamports;
        console.log(`[SOL] Adjusting split amounts by ratio ${ratio}`);
        
        for (const transfer of transfers) {
          transfer.lamports = Math.floor(transfer.lamports * ratio);
        }
      }

      // Create transaction with multiple transfer instructions
      const transaction = new SolanaTransaction();
      
      for (const transfer of transfers) {
        if (transfer.lamports > 0) {
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: new PublicKey(transfer.address),
              lamports: transfer.lamports,
            })
          );
        }
      }

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;

      // Sign and send
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [keypair],
        {
          commitment: 'confirmed',
        }
      );

      console.log(`[SOL] Split transaction sent: ${signature}`);
      return signature;
    } catch (error) {
      console.error('[SOL] Split transaction failed:', error);
      throw new Error(`Failed to send Solana split transaction: ${error}`);
    }
  }

  /**
   * Derive a full 64-byte Solana keypair from a 32-byte Ed25519 seed
   * The full keypair is: seed (32 bytes) + public key (32 bytes)
   */
  private async deriveFullKeypair(seed: Uint8Array): Promise<Uint8Array> {
    // Use Node.js crypto to derive the public key from the seed
    const { createPrivateKey, createPublicKey } = await import('crypto');
    
    // Create Ed25519 private key from seed
    const privateKeyObj = createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'), // ASN.1 prefix for Ed25519 private key
        Buffer.from(seed)
      ]),
      format: 'der',
      type: 'pkcs8'
    });
    
    // Derive public key
    const publicKeyObj = createPublicKey(privateKeyObj);
    const publicKeyDer = publicKeyObj.export({ format: 'der', type: 'spki' });
    
    // Extract raw public key (last 32 bytes of DER encoding)
    const publicKey = publicKeyDer.subarray(-32);
    
    // Combine seed + public key to form the full 64-byte secret key
    const fullKeypair = new Uint8Array(64);
    fullKeypair.set(seed, 0);
    fullKeypair.set(publicKey, 32);
    
    return fullKeypair;
  }

  getRequiredConfirmations(): number {
    return 32;
  }
}

/**
 * Factory function to get the appropriate provider for a blockchain
 */
export function getProvider(
  chain: BlockchainType,
  rpcUrl: string
): BlockchainProvider {
  switch (chain) {
    case 'BTC':
      return new BitcoinProvider(rpcUrl);
    case 'BCH':
      return new BitcoinProvider(rpcUrl); // BCH uses same structure as BTC
    case 'ETH':
      return new EthereumProvider(rpcUrl);
    case 'MATIC':
      return new PolygonProvider(rpcUrl);
    case 'SOL':
      return new SolanaProvider(rpcUrl);
    default:
      throw new Error(`Unsupported blockchain: ${chain}`);
  }
}

/**
 * Get RPC URL from environment variables
 */
export function getRpcUrl(chain: BlockchainType): string {
  const urls: Record<BlockchainType, string> = {
    BTC: process.env.BITCOIN_RPC_URL || 'https://blockchain.info',
    BCH: process.env.BCH_RPC_URL || 'https://bch.blockchain.info',
    ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    MATIC: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    SOL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };

  return urls[chain];
}