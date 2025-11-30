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
export type BlockchainType = 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL';

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
  private async getUTXOs(address: string): Promise<UTXO[]> {
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
  private async broadcastTransaction(txHex: string): Promise<string> {
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
 * Bitcoin Cash provider implementation (extends Bitcoin with different network)
 */
export class BitcoinCashProvider extends BitcoinProvider {
  chain: BlockchainType = 'BCH';

  constructor(rpcUrl: string) {
    // BCH uses the same network parameters as BTC mainnet for legacy addresses
    super(rpcUrl, false);
  }

  /**
   * Override UTXO fetching for BCH
   */
  private async getBCHUTXOs(address: string): Promise<UTXO[]> {
    try {
      const apiKey = process.env.TATUM_API_KEY;
      if (!apiKey) {
        throw new Error('TATUM_API_KEY not configured');
      }

      const response = await axios.get(
        `https://api.tatum.io/v3/bcash/utxo/${address}`,
        {
          headers: {
            'x-api-key': apiKey,
          },
        }
      );

      return response.data.map((utxo: any) => ({
        txid: utxo.txHash,
        vout: utxo.index,
        value: Math.round(parseFloat(utxo.value) * 100000000),
      }));
    } catch (error) {
      console.error('[BCH] Failed to fetch UTXOs:', error);
      throw new Error(`Failed to fetch BCH UTXOs: ${error}`);
    }
  }

  /**
   * Override broadcast for BCH
   */
  private async broadcastBCHTransaction(txHex: string): Promise<string> {
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

  async getBalance(address: string): Promise<string> {
    try {
      const apiKey = process.env.TATUM_API_KEY;
      if (!apiKey) {
        // Fallback to blockchain.info style API
        return super.getBalance(address);
      }

      const response = await axios.get(
        `https://api.tatum.io/v3/bcash/address/balance/${address}`,
        {
          headers: {
            'x-api-key': apiKey,
          },
        }
      );

      return response.data.incoming || '0';
    } catch (error) {
      console.error('Error fetching BCH balance:', error);
      return '0';
    }
  }

  getRequiredConfirmations(): number {
    return 6; // BCH typically needs more confirmations
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
      return new EthereumProvider(rpcUrl);
    case 'POL':
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
    POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    SOL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };

  return urls[chain];
}