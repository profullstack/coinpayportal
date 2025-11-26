import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';

/**
 * Supported blockchain types
 */
export type BlockchainType = 'BTC' | 'BCH' | 'ETH' | 'MATIC' | 'SOL';

/**
 * Transaction details interface
 */
export interface Transaction {
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
  getTransaction(txHash: string): Promise<Transaction>;
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

  async getTransaction(txHash: string): Promise<Transaction> {
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

  async getTransaction(txHash: string): Promise<Transaction> {
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
      const tx = await wallet.sendTransaction({
        to,
        value: ethers.parseEther(amount),
      });
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Failed to send Ethereum transaction: ${error}`);
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

  async getTransaction(txHash: string): Promise<Transaction> {
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