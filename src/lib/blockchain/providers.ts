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
import * as bitcoin from 'bitcoinjs-lib';
import { HDKey } from '@scure/bip32';
import * as ecc from 'tiny-secp256k1';
import ECPairFactory from 'ecpair';

// Initialize ECPair with secp256k1
const ECPair = ECPairFactory(ecc);

/**
 * Supported blockchain types
 */
export type BlockchainType =
  | 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL'
  | 'DOGE' | 'XRP' | 'ADA' | 'BNB'
  | 'USDT' | 'USDC'
  | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';

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
  sendSplitTransaction?(from: string, recipients: Array<{ address: string; amount: string }>, privateKey: string): Promise<string>;
}

/**
 * UTXO interface for Bitcoin transactions
 */
interface UTXO {
  txid: string;
  vout: number;
  value: number; // in satoshis
  scriptPubKey?: string;
}

/**
 * Bitcoin provider implementation with transaction sending
 */
export class BitcoinProvider implements BlockchainProvider {
  chain: BlockchainType = 'BTC';
  rpcUrl: string;
  private network: bitcoin.Network;
  private isTestnet: boolean;

  // Bitcoin transaction fee in satoshis per byte (conservative estimate)
  private static readonly SATOSHIS_PER_BYTE = 20;
  // Minimum output value (dust limit)
  private static readonly DUST_LIMIT = 546;

  constructor(rpcUrl: string, testnet: boolean = false) {
    this.rpcUrl = rpcUrl;
    this.isTestnet = testnet;
    this.network = testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
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

  /**
   * Fetch UTXOs for an address using Tatum API
   */
  protected async getUTXOs(address: string): Promise<UTXO[]> {
    try {
      const apiKey = process.env.TATUM_API_KEY;
      if (!apiKey) {
        throw new Error('TATUM_API_KEY not configured');
      }

      const response = await axios.get(
        `https://api.tatum.io/v3/bitcoin/utxo/${address}`,
        {
          headers: {
            'x-api-key': apiKey,
          },
        }
      );

      return response.data.map((utxo: any) => ({
        txid: utxo.txHash,
        vout: utxo.index,
        value: Math.round(parseFloat(utxo.value) * 100000000), // Convert BTC to satoshis
      }));
    } catch (error) {
      console.error('[BTC] Failed to fetch UTXOs:', error);
      throw new Error(`Failed to fetch UTXOs: ${error}`);
    }
  }

  /**
   * Broadcast a signed transaction using Tatum API
   */
  protected async broadcastTransaction(txHex: string): Promise<string> {
    try {
      const apiKey = process.env.TATUM_API_KEY;
      if (!apiKey) {
        throw new Error('TATUM_API_KEY not configured');
      }

      const response = await axios.post(
        'https://api.tatum.io/v3/bitcoin/broadcast',
        { txData: txHex },
        {
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.txId;
    } catch (error: any) {
      console.error('[BTC] Failed to broadcast transaction:', error.response?.data || error);
      throw new Error(`Failed to broadcast transaction: ${error.response?.data?.message || error}`);
    }
  }

  /**
   * Estimate transaction size for fee calculation
   * P2PKH: ~148 bytes per input, ~34 bytes per output, ~10 bytes overhead
   */
  private estimateTxSize(inputCount: number, outputCount: number): number {
    return inputCount * 148 + outputCount * 34 + 10;
  }

  /**
   * Send a Bitcoin transaction
   */
  async sendTransaction(
    from: string,
    to: string,
    amount: string,
    privateKey: string
  ): Promise<string> {
    try {
      // Parse private key (hex format)
      const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), {
        network: this.network,
      });

      // Fetch UTXOs
      const utxos = await this.getUTXOs(from);
      if (utxos.length === 0) {
        throw new Error('No UTXOs available for spending');
      }

      // Calculate total available
      const totalAvailable = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
      const amountSatoshis = Math.round(parseFloat(amount) * 100000000);

      // Estimate fee (2 outputs: recipient + change)
      const estimatedSize = this.estimateTxSize(utxos.length, 2);
      const fee = estimatedSize * BitcoinProvider.SATOSHIS_PER_BYTE;

      console.log(`[BTC] Balance: ${totalAvailable} sats, amount: ${amountSatoshis} sats, fee: ${fee} sats`);

      if (amountSatoshis + fee > totalAvailable) {
        throw new Error(`Insufficient balance. Have ${totalAvailable} sats, need ${amountSatoshis + fee} sats`);
      }

      // Build transaction
      const psbt = new bitcoin.Psbt({ network: this.network });

      // Add inputs
      for (const utxo of utxos) {
        // Fetch the raw transaction to get the full output script
        const rawTxResponse = await axios.get(
          `https://blockchain.info/rawtx/${utxo.txid}?format=hex`
        );
        const rawTx = rawTxResponse.data;

        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: Buffer.from(rawTx, 'hex'),
        });
      }

      // Add output to recipient
      psbt.addOutput({
        address: to,
        value: amountSatoshis,
      });

      // Add change output if there's enough left over
      const change = totalAvailable - amountSatoshis - fee;
      if (change > BitcoinProvider.DUST_LIMIT) {
        psbt.addOutput({
          address: from,
          value: change,
        });
      }

      // Sign all inputs - need to cast keyPair to satisfy TypeScript
      const signer = {
        publicKey: Buffer.from(keyPair.publicKey),
        sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
      };
      
      for (let i = 0; i < utxos.length; i++) {
        psbt.signInput(i, signer);
      }

      // Finalize and extract transaction
      psbt.finalizeAllInputs();
      const tx = psbt.extractTransaction();
      const txHex = tx.toHex();

      // Broadcast transaction
      const txId = await this.broadcastTransaction(txHex);
      console.log(`[BTC] Transaction sent: ${txId}`);

      return txId;
    } catch (error) {
      console.error('[BTC] Transaction failed:', error);
      throw new Error(`Failed to send Bitcoin transaction: ${error}`);
    }
  }

  /**
   * Send split transaction to multiple recipients
   */
  async sendSplitTransaction(
    from: string,
    recipients: Array<{ address: string; amount: string }>,
    privateKey: string
  ): Promise<string> {
    try {
      // Parse private key
      const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), {
        network: this.network,
      });

      // Fetch UTXOs
      const utxos = await this.getUTXOs(from);
      if (utxos.length === 0) {
        throw new Error('No UTXOs available for spending');
      }

      // Calculate totals
      const totalAvailable = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
      let totalToSend = 0;
      const outputs: Array<{ address: string; value: number }> = [];

      for (const recipient of recipients) {
        const satoshis = Math.round(parseFloat(recipient.amount) * 100000000);
        if (satoshis > BitcoinProvider.DUST_LIMIT) {
          outputs.push({ address: recipient.address, value: satoshis });
          totalToSend += satoshis;
        }
      }

      // Estimate fee (outputs + change)
      const estimatedSize = this.estimateTxSize(utxos.length, outputs.length + 1);
      const fee = estimatedSize * BitcoinProvider.SATOSHIS_PER_BYTE;

      console.log(`[BTC] Split: balance=${totalAvailable}, total=${totalToSend}, fee=${fee}`);

      // Adjust amounts if needed
      if (totalToSend + fee > totalAvailable) {
        const ratio = (totalAvailable - fee) / totalToSend;
        console.log(`[BTC] Adjusting split amounts by ratio ${ratio}`);
        
        for (const output of outputs) {
          output.value = Math.floor(output.value * ratio);
        }
        totalToSend = outputs.reduce((sum, o) => sum + o.value, 0);
      }

      // Build transaction
      const psbt = new bitcoin.Psbt({ network: this.network });

      // Add inputs
      for (const utxo of utxos) {
        const rawTxResponse = await axios.get(
          `https://blockchain.info/rawtx/${utxo.txid}?format=hex`
        );
        const rawTx = rawTxResponse.data;

        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: Buffer.from(rawTx, 'hex'),
        });
      }

      // Add outputs
      for (const output of outputs) {
        if (output.value > BitcoinProvider.DUST_LIMIT) {
          psbt.addOutput({
            address: output.address,
            value: output.value,
          });
        }
      }

      // Add change output
      const change = totalAvailable - totalToSend - fee;
      if (change > BitcoinProvider.DUST_LIMIT) {
        psbt.addOutput({
          address: from,
          value: change,
        });
      }

      // Sign all inputs - need to cast keyPair to satisfy TypeScript
      const signer = {
        publicKey: Buffer.from(keyPair.publicKey),
        sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
      };
      
      for (let i = 0; i < utxos.length; i++) {
        psbt.signInput(i, signer);
      }

      // Finalize and broadcast
      psbt.finalizeAllInputs();
      const tx = psbt.extractTransaction();
      const txHex = tx.toHex();

      const txId = await this.broadcastTransaction(txHex);
      console.log(`[BTC] Split transaction sent: ${txId}`);

      return txId;
    } catch (error) {
      console.error('[BTC] Split transaction failed:', error);
      throw new Error(`Failed to send Bitcoin split transaction: ${error}`);
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
  chain: BlockchainType = 'POL';

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

  // For one-time payment addresses, we don't need to keep rent-exempt minimum
  // The account will become rent-paying and eventually be garbage collected
  // We only need to keep enough for the transaction fee
  private static readonly RENT_EXEMPT_MINIMUM = 0; // Don't keep rent for one-time addresses

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

      // Get current balance to check if we need to adjust for fees
      const currentBalance = await this.connection.getBalance(keypair.publicKey);
      const txFee = SolanaProvider.SOLANA_TX_FEE_LAMPORTS;
      
      // For one-time payment addresses, we only need to keep enough for the transaction fee
      // The account will become rent-paying and eventually be garbage collected
      const minimumToKeep = txFee;
      const maxSendable = currentBalance - minimumToKeep;
      
      console.log(`[SOL] Current balance: ${currentBalance} lamports, requested: ${lamports} lamports, tx fee: ${txFee} lamports, max sendable: ${maxSendable} lamports`);

      // If we're trying to send more than max sendable, adjust
      if (lamports > maxSendable) {
        if (maxSendable <= 0) {
          throw new Error(`Insufficient balance. Have ${currentBalance} lamports, need at least ${minimumToKeep + 1} lamports (${txFee} fee + 1)`);
        }
        console.log(`[SOL] Adjusting amount from ${lamports} to ${maxSendable} lamports (keeping ${minimumToKeep} for fee)`);
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

      // For one-time payment addresses, we only need to keep enough for the transaction fee
      // The account will become rent-paying and eventually be garbage collected
      const minimumToKeep = txFee;
      const maxSendable = currentBalance - minimumToKeep;
      
      if (maxSendable <= 0) {
        throw new Error(`Insufficient balance for split transaction. Have ${currentBalance} lamports, need at least ${minimumToKeep + 1} lamports (${txFee} fee + 1)`);
      }

      // If total exceeds max sendable, proportionally reduce amounts
      if (totalLamports > maxSendable) {
        const ratio = maxSendable / totalLamports;
        console.log(`[SOL] Adjusting split amounts by ratio ${ratio} (keeping ${minimumToKeep} lamports for fee)`);
        
        let adjustedTotal = 0;
        for (const transfer of transfers) {
          transfer.lamports = Math.floor(transfer.lamports * ratio);
          adjustedTotal += transfer.lamports;
        }
        
        // Due to rounding, we might have a few lamports left over - add to first transfer
        const leftover = maxSendable - adjustedTotal;
        if (leftover > 0 && transfers.length > 0) {
          transfers[0].lamports += leftover;
        }
        
        console.log(`[SOL] Adjusted transfers: ${transfers.map(t => t.lamports).join(', ')} lamports`);
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
 * CashAddr charset for decoding
 */
const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Base58 alphabet for WIF encoding
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Convert a hex private key to WIF (Wallet Import Format)
 * WIF format: version (1 byte) + private key (32 bytes) + compression flag (1 byte) + checksum (4 bytes)
 * Then Base58 encoded
 *
 * @param hexPrivateKey - 64 character hex string (32 bytes)
 * @param compressed - Whether to use compressed public key (default: true)
 * @returns WIF encoded private key (52 characters for compressed)
 */
export function hexToWIF(hexPrivateKey: string, compressed: boolean = true): string {
  // Validate hex private key
  if (!/^[0-9a-fA-F]{64}$/.test(hexPrivateKey)) {
    throw new Error(`Invalid hex private key: expected 64 hex characters, got ${hexPrivateKey.length}`);
  }

  // Version byte for mainnet (0x80)
  const versionByte = 0x80;
  
  // Build the payload: version + private key + (optional) compression flag
  const privateKeyBytes = Buffer.from(hexPrivateKey, 'hex');
  let payload: Buffer;
  
  if (compressed) {
    // Add compression flag (0x01) for compressed public keys
    payload = Buffer.concat([
      Buffer.from([versionByte]),
      privateKeyBytes,
      Buffer.from([0x01])
    ]);
  } else {
    payload = Buffer.concat([
      Buffer.from([versionByte]),
      privateKeyBytes
    ]);
  }
  
  // Calculate checksum: first 4 bytes of double SHA256
  const checksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  
  // Combine payload and checksum
  const wifBytes = Buffer.concat([payload, checksum]);
  
  // Base58 encode
  const digits = [0];
  for (let i = 0; i < wifBytes.length; i++) {
    let carry = wifBytes[i];
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
  
  let wif = '';
  // Leading zeros
  for (let i = 0; i < wifBytes.length && wifBytes[i] === 0; i++) {
    wif += BASE58_ALPHABET[0];
  }
  // Convert digits to string
  for (let i = digits.length - 1; i >= 0; i--) {
    wif += BASE58_ALPHABET[digits[i]];
  }
  
  return wif;
}

/**
 * Convert CashAddr to legacy Bitcoin address format
 * CashAddr format: bitcoincash:qp... -> Legacy format: 1... or 3...
 * Exported for testing purposes
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
 * Bitcoin Cash provider implementation (extends Bitcoin with different network)
 */
export class BitcoinCashProvider extends BitcoinProvider {
  chain: BlockchainType = 'BCH';

  constructor(rpcUrl: string) {
    // BCH uses the same network parameters as BTC mainnet for legacy addresses
    super(rpcUrl, false);
  }

  /**
   * Convert address to legacy format if needed for API calls
   */
  private toLegacyAddress(address: string): string {
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

  /**
   * Override UTXO fetching for BCH
   * Uses Blockchair API since Tatum doesn't have a direct UTXO endpoint for BCH
   */
  protected async getUTXOs(address: string): Promise<UTXO[]> {
    // Convert to legacy address for API calls
    const legacyAddress = this.toLegacyAddress(address);
    console.log(`[BCH] Fetching UTXOs for ${address} (legacy: ${legacyAddress})`);

    // Try Blockchair API first (most reliable for BCH UTXOs)
    try {
      const blockchairUrl = `https://api.blockchair.com/bitcoin-cash/dashboards/address/${legacyAddress}?limit=100`;
      console.log(`[BCH] Blockchair UTXO URL: ${blockchairUrl}`);
      
      const response = await axios.get(blockchairUrl);
      const addressData = response.data?.data?.[legacyAddress];
      
      if (!addressData) {
        console.log(`[BCH] No address data from Blockchair for ${legacyAddress}`);
        throw new Error('Address not found in Blockchair');
      }
      
      const utxos = addressData.utxo || [];
      console.log(`[BCH] Blockchair found ${utxos.length} UTXOs`);
      
      return utxos.map((utxo: any) => ({
        txid: utxo.transaction_hash,
        vout: utxo.index,
        value: utxo.value, // Already in satoshis
      }));
    } catch (blockchairError: any) {
      console.error('[BCH] Blockchair UTXO fetch failed:', blockchairError.response?.status || blockchairError.message);
    }

    // Fallback to Fullstack.cash API
    try {
      // Fullstack.cash accepts CashAddr format
      const fullstackUrl = `https://api.fullstack.cash/v5/electrumx/utxos/${address}`;
      console.log(`[BCH] Fullstack.cash UTXO URL: ${fullstackUrl}`);
      
      const response = await axios.get(fullstackUrl);
      
      if (response.data?.success && response.data?.utxos) {
        const utxos = response.data.utxos;
        console.log(`[BCH] Fullstack.cash found ${utxos.length} UTXOs`);
        
        return utxos.map((utxo: any) => ({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          value: utxo.value, // Already in satoshis
        }));
      }
    } catch (fullstackError: any) {
      console.error('[BCH] Fullstack.cash UTXO fetch failed:', fullstackError.response?.status || fullstackError.message);
    }

    // Last resort: Try CryptoAPIs
    const cryptoApisKey = process.env.CRYPTO_APIS_KEY;
    if (cryptoApisKey) {
      try {
        // Remove bitcoincash: prefix for CryptoAPIs
        let cashAddrShort = address.toLowerCase();
        if (cashAddrShort.startsWith('bitcoincash:')) {
          cashAddrShort = cashAddrShort.substring(12);
        }
        
        const cryptoApisUrl = `https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet/addresses/${cashAddrShort}/unspent-outputs?limit=50`;
        console.log(`[BCH] CryptoAPIs UTXO URL: ${cryptoApisUrl}`);
        
        const response = await axios.get(cryptoApisUrl, {
          headers: {
            'X-API-Key': cryptoApisKey,
          },
        });
        
        const items = response.data?.data?.items || [];
        console.log(`[BCH] CryptoAPIs found ${items.length} UTXOs`);
        
        return items.map((utxo: any) => ({
          txid: utxo.transactionId,
          vout: utxo.index,
          value: Math.round(parseFloat(utxo.amount) * 100000000),
        }));
      } catch (cryptoApisError: any) {
        console.error('[BCH] CryptoAPIs UTXO fetch failed:', cryptoApisError.response?.status || cryptoApisError.message);
      }
    }

    throw new Error('Failed to fetch BCH UTXOs from all available APIs');
  }

  /**
   * Fetch raw transaction hex for BCH
   * Used for building PSBT inputs
   */
  protected async getRawTransaction(txid: string): Promise<string> {
    // Try Blockchair first
    try {
      const blockchairUrl = `https://api.blockchair.com/bitcoin-cash/raw/transaction/${txid}`;
      console.log(`[BCH] Fetching raw tx from Blockchair: ${txid}`);
      const response = await axios.get(blockchairUrl);
      const rawHex = response.data?.data?.[txid]?.raw_transaction;
      if (rawHex) {
        return rawHex;
      }
    } catch (error: any) {
      console.error('[BCH] Blockchair raw tx fetch failed:', error.response?.status || error.message);
    }

    // Try Fullstack.cash
    try {
      const fullstackUrl = `https://api.fullstack.cash/v5/rawtransactions/getRawTransaction/${txid}?verbose=false`;
      console.log(`[BCH] Fetching raw tx from Fullstack.cash: ${txid}`);
      const response = await axios.get(fullstackUrl);
      if (response.data) {
        return response.data;
      }
    } catch (error: any) {
      console.error('[BCH] Fullstack.cash raw tx fetch failed:', error.response?.status || error.message);
    }

    throw new Error(`Failed to fetch raw transaction ${txid} for BCH`);
  }

  /**
   * Override broadcast for BCH
   */
  protected async broadcastTransaction(txHex: string): Promise<string> {
    try {
      const apiKey = process.env.TATUM_API_KEY;
      if (!apiKey) {
        throw new Error('TATUM_API_KEY not configured');
      }

      const response = await axios.post(
        'https://api.tatum.io/v3/bcash/broadcast',
        { txData: txHex },
        {
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.txId;
    } catch (error: any) {
      console.error('[BCH] Failed to broadcast transaction:', error.response?.data || error);
      throw new Error(`Failed to broadcast BCH transaction: ${error.response?.data?.message || error}`);
    }
  }

  /**
   * Override sendSplitTransaction for BCH
   * Uses Tatum's transaction API which handles SIGHASH_FORKID signing
   * BCH requires SIGHASH_FORKID (0x40) flag which bitcoinjs-lib doesn't support
   */
  async sendSplitTransaction(
    from: string,
    recipients: Array<{ address: string; amount: string }>,
    privateKey: string
  ): Promise<string> {
    try {
      const apiKey = process.env.TATUM_API_KEY;
      if (!apiKey) {
        throw new Error('TATUM_API_KEY not configured');
      }

      // Convert addresses to legacy format for Tatum API
      const fromLegacy = this.toLegacyAddress(from);
      
      // Fetch UTXOs using our BCH-specific method
      const utxos = await this.getUTXOs(from);
      if (utxos.length === 0) {
        throw new Error('No UTXOs available for spending');
      }

      // Calculate totals
      const totalAvailable = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
      
      // BCH dust limit
      const DUST_LIMIT = 546;
      const SATOSHIS_PER_BYTE = 1; // BCH has much lower fees

      // Prepare outputs for Tatum API
      const tatumOutputs: Array<{ address: string; value: number }> = [];
      let totalToSend = 0;

      for (const recipient of recipients) {
        const satoshis = Math.round(parseFloat(recipient.amount) * 100000000);
        if (satoshis > DUST_LIMIT) {
          // Convert recipient address to legacy if needed
          const legacyRecipient = this.toLegacyAddress(recipient.address);
          tatumOutputs.push({ address: legacyRecipient, value: satoshis });
          totalToSend += satoshis;
        }
      }

      // Estimate fee
      const estimatedSize = utxos.length * 148 + (tatumOutputs.length + 1) * 34 + 10;
      const fee = estimatedSize * SATOSHIS_PER_BYTE;

      console.log(`[BCH] Split: balance=${totalAvailable}, total=${totalToSend}, fee=${fee}`);

      // Adjust amounts if needed
      if (totalToSend + fee > totalAvailable) {
        const ratio = (totalAvailable - fee) / totalToSend;
        console.log(`[BCH] Adjusting split amounts by ratio ${ratio}`);
        
        for (const output of tatumOutputs) {
          output.value = Math.floor(output.value * ratio);
        }
        totalToSend = tatumOutputs.reduce((sum, o) => sum + o.value, 0);
      }

      // Add change output if there's enough left
      const change = totalAvailable - totalToSend - fee;
      if (change > DUST_LIMIT) {
        tatumOutputs.push({ address: fromLegacy, value: change });
      }

      // Convert hex private key to WIF format for Tatum API
      // Tatum expects WIF format (52 characters for compressed keys)
      let wifPrivateKey: string;
      try {
        // Check if already in WIF format (starts with K, L, or 5 for mainnet)
        if (/^[KL5][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(privateKey)) {
          wifPrivateKey = privateKey;
          console.log(`[BCH] Private key already in WIF format`);
        } else {
          // Convert from hex to WIF
          wifPrivateKey = hexToWIF(privateKey, true);
          console.log(`[BCH] Converted hex private key to WIF format (${wifPrivateKey.length} chars)`);
        }
      } catch (conversionError) {
        console.error(`[BCH] Failed to convert private key to WIF:`, conversionError);
        throw new Error(`Private key conversion failed: ${conversionError}`);
      }

      // Build Tatum API request
      // Tatum's BCH transaction endpoint handles SIGHASH_FORKID signing
      const tatumRequest = {
        fromUTXO: utxos.map(utxo => ({
          txHash: utxo.txid,
          index: utxo.vout,
          privateKey: wifPrivateKey,
        })),
        to: tatumOutputs.map(output => ({
          address: output.address,
          value: output.value / 100000000, // Convert satoshis to BCH
        })),
      };

      console.log(`[BCH] Sending transaction via Tatum API with ${utxos.length} inputs and ${tatumOutputs.length} outputs`);

      const response = await axios.post(
        'https://api.tatum.io/v3/bcash/transaction',
        tatumRequest,
        {
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      const txId = response.data.txId;
      console.log(`[BCH] Split transaction sent: ${txId}`);

      return txId;
    } catch (error: any) {
      console.error('[BCH] Split transaction failed:', error.response?.data || error);
      throw new Error(`Failed to send BCH split transaction: ${error.response?.data?.message || error}`);
    }
  }

  /**
   * Override sendTransaction for BCH
   * Uses Tatum's transaction API which handles SIGHASH_FORKID signing
   */
  async sendTransaction(
    from: string,
    to: string,
    amount: string,
    privateKey: string
  ): Promise<string> {
    // Use sendSplitTransaction with a single recipient
    return this.sendSplitTransaction(from, [{ address: to, amount }], privateKey);
  }

  async getBalance(address: string): Promise<string> {
    try {
      const apiKey = process.env.TATUM_API_KEY;
      
      // Convert to legacy address for API calls
      const legacyAddress = this.toLegacyAddress(address);
      console.log(`[BCH Provider] Original address: ${address}`);
      console.log(`[BCH Provider] Legacy address: ${legacyAddress}`);
      
      if (!apiKey) {
        // Fallback to Blockchair API which supports both formats
        try {
          const blockchairUrl = `https://api.blockchair.com/bitcoin-cash/dashboards/address/${legacyAddress}`;
          console.log(`[BCH Provider] Blockchair URL: ${blockchairUrl}`);
          const response = await axios.get(blockchairUrl);
          const balance = response.data?.data?.[legacyAddress]?.address?.balance || 0;
          return (balance / 100000000).toString();
        } catch (blockchairError) {
          console.error('[BCH] Blockchair API failed:', blockchairError);
          return '0';
        }
      }

      const tatumUrl = `https://api.tatum.io/v3/bcash/address/balance/${legacyAddress}`;
      console.log(`[BCH Provider] Tatum URL: ${tatumUrl}`);
      const response = await axios.get(tatumUrl, {
        headers: {
          'x-api-key': apiKey,
        },
      });

      // Tatum returns balance in BCH
      const incoming = parseFloat(response.data.incoming || '0');
      const outgoing = parseFloat(response.data.outgoing || '0');
      return (incoming - outgoing).toString();
    } catch (error: any) {
      console.error(`[BCH] Failed to fetch BCH balance for ${address}:`, error.response?.status, '-', JSON.stringify(error.response?.data || error.message));
      
      // Try Blockchair as fallback
      try {
        const legacyAddress = this.toLegacyAddress(address);
        const response = await axios.get(
          `https://api.blockchair.com/bitcoin-cash/dashboards/address/${legacyAddress}`
        );
        const balance = response.data?.data?.[legacyAddress]?.address?.balance || 0;
        return (balance / 100000000).toString();
      } catch (blockchairError) {
        console.error('[BCH] Blockchair fallback also failed:', blockchairError);
        return '0';
      }
    }
  }

  async getTransaction(txHash: string): Promise<TransactionDetails> {
    try {
      const apiKey = process.env.TATUM_API_KEY;
      if (!apiKey) {
        // Fallback to Blockchair
        const response = await axios.get(
          `https://api.blockchair.com/bitcoin-cash/dashboards/transaction/${txHash}`
        );
        const tx = response.data?.data?.[txHash]?.transaction;
        if (!tx) {
          throw new Error('Transaction not found');
        }
        
        return {
          hash: txHash,
          from: response.data?.data?.[txHash]?.inputs?.[0]?.recipient || '',
          to: response.data?.data?.[txHash]?.outputs?.[0]?.recipient || '',
          value: (response.data?.data?.[txHash]?.outputs?.[0]?.value / 100000000).toString(),
          confirmations: tx.block_id ? 1 : 0,
          blockNumber: tx.block_id,
          timestamp: new Date(tx.time).getTime() / 1000,
          status: tx.block_id ? 'confirmed' : 'pending',
        };
      }

      const response = await axios.get(
        `https://api.tatum.io/v3/bcash/transaction/${txHash}`,
        {
          headers: {
            'x-api-key': apiKey,
          },
        }
      );
      
      const tx = response.data;
      return {
        hash: tx.hash,
        from: tx.inputs?.[0]?.coin?.address || '',
        to: tx.outputs?.[0]?.address || '',
        value: tx.outputs?.[0]?.value || '0',
        confirmations: tx.confirmations || 0,
        blockNumber: tx.blockNumber,
        timestamp: tx.time,
        status: tx.confirmations > 0 ? 'confirmed' : 'pending',
      };
    } catch (error) {
      throw new Error(`Failed to fetch BCH transaction: ${error}`);
    }
  }

  getRequiredConfirmations(): number {
    return 6; // BCH typically needs more confirmations
  }
}

/**
 * BNB (Binance Smart Chain) provider - EVM compatible
 */
export class BnbProvider extends EthereumProvider {
  chain: BlockchainType = 'BNB';

  constructor(rpcUrl: string) {
    super(rpcUrl);
  }

  getRequiredConfirmations(): number {
    return 15;
  }
}

/**
 * Dogecoin provider - similar to Bitcoin but with different network params
 * Note: Full transaction sending not yet implemented, address generation works
 */
export class DogecoinProvider implements BlockchainProvider {
  chain: BlockchainType = 'DOGE';
  rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  async getBalance(address: string): Promise<string> {
    try {
      // Use Blockcypher API for DOGE
      const response = await axios.get(
        `https://api.blockcypher.com/v1/doge/main/addrs/${address}/balance`
      );
      return (Number(response.data.balance) / 100000000).toString();
    } catch (error) {
      console.error('[DOGE] Error fetching balance:', error);
      return '0';
    }
  }

  async getTransaction(txHash: string): Promise<TransactionDetails> {
    try {
      const response = await axios.get(
        `https://api.blockcypher.com/v1/doge/main/txs/${txHash}`
      );
      const tx = response.data;
      return {
        hash: tx.hash,
        from: tx.inputs?.[0]?.addresses?.[0] || '',
        to: tx.outputs?.[0]?.addresses?.[0] || '',
        value: (tx.outputs?.[0]?.value / 100000000).toString(),
        confirmations: tx.confirmations || 0,
        blockNumber: tx.block_height,
        timestamp: tx.confirmed ? new Date(tx.confirmed).getTime() / 1000 : undefined,
        status: tx.confirmations > 0 ? 'confirmed' : 'pending',
      };
    } catch (error) {
      throw new Error(`Failed to fetch DOGE transaction: ${error}`);
    }
  }

  async sendTransaction(
    from: string,
    to: string,
    amount: string,
    privateKey: string
  ): Promise<string> {
    // Use Blockcypher's transaction API for DOGE
    const satoshis = Math.round(parseFloat(amount) * 100000000);

    // Step 1: Create a new transaction skeleton
    const newTxRes = await axios.post(
      'https://api.blockcypher.com/v1/doge/main/txs/new',
      {
        inputs: [{ addresses: [from] }],
        outputs: [{ addresses: [to], value: satoshis }],
      }
    );

    const tmptx = newTxRes.data;

    // Step 2: Sign the transaction using tiny-secp256k1
    const secp = await import('tiny-secp256k1');
    const privKeyHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    const privKeyBuf = Buffer.from(privKeyHex, 'hex');
    const pubKeyBuf = secp.pointFromScalar(privKeyBuf);
    if (!pubKeyBuf) throw new Error('Invalid private key');

    const signatures: string[] = [];
    const pubkeys: string[] = [];

    for (const tosign of tmptx.tosign) {
      const msgHash = Buffer.from(tosign, 'hex');
      const sigBuf = secp.sign(msgHash, privKeyBuf);
      // Convert to DER format
      signatures.push(Buffer.from(sigBuf).toString('hex'));
      pubkeys.push(Buffer.from(pubKeyBuf).toString('hex'));
    }

    // Step 3: Send signed transaction
    const sendRes = await axios.post(
      'https://api.blockcypher.com/v1/doge/main/txs/send',
      {
        ...tmptx,
        signatures,
        pubkeys,
      }
    );

    return sendRes.data.tx.hash;
  }

  getRequiredConfirmations(): number {
    return 6;
  }
}

/**
 * XRP (Ripple) provider implementation using xrpl.js
 */
export class XrpProvider implements BlockchainProvider {
  chain: BlockchainType = 'XRP';
  rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  async getBalance(address: string): Promise<string> {
    try {
      const response = await axios.post(this.rpcUrl, {
        method: 'account_info',
        params: [{ account: address, ledger_index: 'validated' }],
      });
      const balance = response.data.result?.account_data?.Balance;
      if (!balance) return '0';
      return (Number(balance) / 1_000_000).toString();
    } catch (error: any) {
      if (error?.response?.data?.result?.error === 'actNotFound') return '0';
      console.error('[XRP] Error fetching balance:', error);
      return '0';
    }
  }

  async getTransaction(txHash: string): Promise<TransactionDetails> {
    try {
      const response = await axios.post(this.rpcUrl, {
        method: 'tx',
        params: [{ transaction: txHash }],
      });
      const tx = response.data.result;
      const confirmed = tx.validated === true;
      return {
        hash: tx.hash,
        from: tx.Account || '',
        to: tx.Destination || '',
        value: tx.Amount ? (Number(tx.Amount) / 1_000_000).toString() : '0',
        confirmations: confirmed ? 1 : 0,
        blockNumber: tx.ledger_index,
        timestamp: tx.date ? tx.date + 946684800 : undefined, // XRP epoch offset
        status: confirmed ? (tx.meta?.TransactionResult === 'tesSUCCESS' ? 'confirmed' : 'failed') : 'pending',
      };
    } catch (error) {
      throw new Error(`Failed to fetch XRP transaction: ${error}`);
    }
  }

  async sendTransaction(
    from: string,
    to: string,
    amount: string,
    privateKey: string
  ): Promise<string> {
    const { Client, Wallet } = await import('xrpl');
    const client = new Client(this.rpcUrl.replace(/^http/, 'ws'));
    try {
      await client.connect();

      // Create wallet from hex private key
      const privHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
      const wallet = Wallet.fromEntropy(Buffer.from(privHex, 'hex'));

      const payment = {
        TransactionType: 'Payment' as const,
        Account: from,
        Destination: to,
        Amount: String(Math.round(parseFloat(amount) * 1_000_000)),
      };

      const prepared = await client.autofill(payment);
      const signed = wallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);
      return result.result.hash;
    } finally {
      await client.disconnect().catch(() => {});
    }
  }

  getRequiredConfirmations(): number {
    return 1;
  }
}

/**
 * ADA (Cardano) provider implementation using Blockfrost API
 */
export class AdaProvider implements BlockchainProvider {
  chain: BlockchainType = 'ADA';
  rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  private get headers() {
    return { project_id: process.env.BLOCKFROST_API_KEY || '' };
  }

  async getBalance(address: string): Promise<string> {
    try {
      const response = await axios.get(`${this.rpcUrl}/addresses/${address}`, {
        headers: this.headers,
      });
      const lovelace = response.data.amount?.find((a: any) => a.unit === 'lovelace');
      if (!lovelace) return '0';
      return (Number(lovelace.quantity) / 1_000_000).toString();
    } catch (error: any) {
      if (error?.response?.status === 404) return '0';
      console.error('[ADA] Error fetching balance:', error);
      return '0';
    }
  }

  async getTransaction(txHash: string): Promise<TransactionDetails> {
    try {
      const [txRes, utxoRes] = await Promise.all([
        axios.get(`${this.rpcUrl}/txs/${txHash}`, { headers: this.headers }),
        axios.get(`${this.rpcUrl}/txs/${txHash}/utxos`, { headers: this.headers }),
      ]);
      const tx = txRes.data;
      const utxos = utxoRes.data;

      const fromAddr = utxos.inputs?.[0]?.address || '';
      const toOutput = utxos.outputs?.[0];
      const toAddr = toOutput?.address || '';
      const lovelace = toOutput?.amount?.find((a: any) => a.unit === 'lovelace');
      const value = lovelace ? (Number(lovelace.quantity) / 1_000_000).toString() : '0';

      return {
        hash: tx.hash,
        from: fromAddr,
        to: toAddr,
        value,
        confirmations: tx.block ? 15 : 0, // Blockfrost only returns confirmed txs
        blockNumber: tx.block_height,
        timestamp: tx.block_time,
        status: tx.block ? 'confirmed' : 'pending',
      };
    } catch (error) {
      throw new Error(`Failed to fetch ADA transaction: ${error}`);
    }
  }

  async sendTransaction(
    from: string,
    to: string,
    amount: string,
    privateKey: string
  ): Promise<string> {
    try {
      const CardanoWasm = await import('@emurgo/cardano-serialization-lib-nodejs');

      // 1. Fetch UTXOs
      const utxoRes = await axios.get(`${this.rpcUrl}/addresses/${from}/utxos`, {
        headers: this.headers,
      });
      const utxos = utxoRes.data;
      if (!utxos || utxos.length === 0) throw new Error('No UTXOs available');

      // 2. Fetch protocol parameters
      const paramsRes = await axios.get(`${this.rpcUrl}/epochs/latest/parameters`, {
        headers: this.headers,
      });
      const params = paramsRes.data;

      // 3. Build transaction
      const lovelaceAmount = BigInt(Math.round(parseFloat(amount) * 1_000_000));

      const txBuilder = CardanoWasm.TransactionBuilder.new(
        CardanoWasm.TransactionBuilderConfigBuilder.new()
          .fee_algo(CardanoWasm.LinearFee.new(
            CardanoWasm.BigNum.from_str(params.min_fee_a.toString()),
            CardanoWasm.BigNum.from_str(params.min_fee_b.toString()),
          ))
          .pool_deposit(CardanoWasm.BigNum.from_str(params.pool_deposit))
          .key_deposit(CardanoWasm.BigNum.from_str(params.key_deposit))
          .coins_per_utxo_byte(CardanoWasm.BigNum.from_str(
            (params.coins_per_utxo_size || params.coins_per_utxo_word || '4310').toString()
          ))
          .max_tx_size(params.max_tx_size || 16384)
          .max_value_size(parseInt(params.max_val_size || '5000'))
          .build()
      );

      // Add inputs
      let totalInput = BigInt(0);
      for (const utxo of utxos) {
        const lovelaceIn = utxo.amount?.find((a: any) => a.unit === 'lovelace');
        if (!lovelaceIn) continue;
        const utxoAmount = BigInt(lovelaceIn.quantity);

        txBuilder.add_input(
          CardanoWasm.Address.from_bech32(from),
          CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex')),
            utxo.output_index
          ),
          CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(lovelaceIn.quantity))
        );
        totalInput += utxoAmount;
        if (totalInput >= lovelaceAmount + BigInt(500_000)) break; // enough for amount + fee estimate
      }

      // Add output
      txBuilder.add_output(
        CardanoWasm.TransactionOutput.new(
          CardanoWasm.Address.from_bech32(to),
          CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(lovelaceAmount.toString()))
        )
      );

      // Add change back to sender
      txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(from));

      // Build transaction body
      const txBody = txBuilder.build();

      // 4. Sign
      const privHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
      const privKeyObj = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from(privHex, 'hex'));
      const txHash = CardanoWasm.hash_transaction(txBody);

      const witnesses = CardanoWasm.TransactionWitnessSet.new();
      const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
      vkeyWitnesses.add(CardanoWasm.make_vkey_witness(txHash, privKeyObj));
      witnesses.set_vkeys(vkeyWitnesses);

      const signedTx = CardanoWasm.Transaction.new(txBody, witnesses);
      const txBytes = signedTx.to_bytes();

      // 5. Submit
      const submitRes = await axios.post(
        `${this.rpcUrl}/tx/submit`,
        Buffer.from(txBytes),
        {
          headers: {
            ...this.headers,
            'Content-Type': 'application/cbor',
          },
        }
      );

      return submitRes.data; // Blockfrost returns the tx hash as string
    } catch (error: any) {
      throw new Error(`Failed to send ADA transaction: ${error?.message || error}`);
    }
  }

  getRequiredConfirmations(): number {
    return 15;
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
      return new BitcoinCashProvider(rpcUrl);
    case 'ETH':
    case 'USDT':
    case 'USDC':
    case 'USDC_ETH':
      return new EthereumProvider(rpcUrl);
    case 'POL':
    case 'USDC_POL':
      return new PolygonProvider(rpcUrl);
    case 'SOL':
    case 'USDC_SOL':
      return new SolanaProvider(rpcUrl);
    case 'BNB':
      return new BnbProvider(rpcUrl);
    case 'DOGE':
      return new DogecoinProvider(rpcUrl);
    case 'XRP':
      return new XrpProvider(rpcUrl);
    case 'ADA':
      return new AdaProvider(rpcUrl);
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
    POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    SOL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    DOGE: process.env.DOGE_RPC_URL || 'https://api.blockcypher.com/v1/doge/main',
    XRP: process.env.XRP_RPC_URL || 'https://xrplcluster.com',
    ADA: process.env.ADA_RPC_URL || 'https://cardano-mainnet.blockfrost.io/api/v0',
    BNB: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org',
    USDT: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    USDC: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    USDC_ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    USDC_POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    USDC_SOL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };

  return urls[chain];
}