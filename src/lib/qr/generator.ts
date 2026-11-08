import QRCode from 'qrcode';

/**
 * Supported blockchain types
 */
export type Blockchain =
  | 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL'
  | 'DOGE' | 'XRP' | 'ADA' | 'BNB'
  | 'USDT' | 'USDT_ETH' | 'USDT_POL' | 'USDT_SOL' | 'USDT_TRON'
  | 'USDC'
  | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL' | 'USDC_BASE';

/**
 * QR code generation options
 */
export interface QROptions {
  width?: number;
  margin?: number;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  color?: {
    dark?: string;
    light?: string;
  };
}

/**
 * Payment QR code parameters
 */
export interface PaymentQRParams {
  blockchain: Blockchain;
  address: string;
  amount: number;
  label?: string;
  message?: string;
}

/**
 * Default QR code options
 */
const DEFAULT_QR_OPTIONS: QROptions = {
  width: 300,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: {
    dark: '#000000',
    light: '#FFFFFF',
  },
};

/**
 * Generate a QR code as data URL
 * @param data - Data to encode in QR code
 * @param options - QR code generation options
 * @returns Data URL of QR code image
 */
export async function generateQRCode(
  data: string,
  options: QROptions = {}
): Promise<string> {
  try {
    // Validate input
    if (!data || data.length === 0) {
      throw new Error('Data cannot be empty');
    }

    // Merge options with defaults
    const qrOptions = {
      ...DEFAULT_QR_OPTIONS,
      ...options,
    };

    // Generate QR code
    const dataURL = await QRCode.toDataURL(data, qrOptions);
    return dataURL;
  } catch (error) {
    throw new Error(
      `QR code generation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Chain IDs for EVM networks (EIP-681 standard)
 */
const CHAIN_IDS: Record<string, number> = {
  ETH: 1,
  POL: 137,
  BNB: 56,
  // Bare USDT/USDC are the legacy codes for the Ethereum-mainnet tokens
  USDT: 1,
  USDC: 1,
  USDT_ETH: 1,
  USDT_POL: 137,
  USDC_ETH: 1,
  USDC_POL: 137,
  USDC_BASE: 8453,
};

/**
 * Token contract addresses for ERC-20/SPL tokens
 */
const TOKEN_CONTRACTS: Record<string, string> = {
  // Legacy bare codes: the Ethereum-mainnet contracts
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  // USDT on Ethereum mainnet
  USDT_ETH: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  // USDT on Polygon mainnet
  USDT_POL: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  // USDT on Solana (SPL token mint address)
  USDT_SOL: 'Es9vMFrzaCERmJfrF4H2FYDUTR4o4M2xq9knkXJmNQp7',
  // USDC on Ethereum mainnet
  USDC_ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  // USDC on Polygon mainnet (native USDC)
  USDC_POL: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  // USDC on Solana (SPL token mint address)
  USDC_SOL: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // USDC on Base mainnet (native, Circle-issued)
  USDC_BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

/**
 * Token decimals for proper amount conversion
 */
const TOKEN_DECIMALS: Record<string, number> = {
  BTC: 8,
  BCH: 8,
  ETH: 18,
  POL: 18,
  SOL: 9,
  DOGE: 8,
  XRP: 6,
  ADA: 6,
  BNB: 18,
  USDT: 6,
  USDT_ETH: 6,
  USDT_POL: 6,
  USDT_SOL: 6,
  USDT_TRON: 6,
  USDC: 6,
  USDC_ETH: 6,
  USDC_POL: 6,
  USDC_SOL: 6,
  USDC_BASE: 6,
};

/**
 * Get payment URI scheme for blockchain
 */
function getPaymentScheme(blockchain: Blockchain): string {
  return PAYMENT_SCHEMES[blockchain];
}

/**
 * URI scheme per chain. Typed as a full Record so adding a chain to
 * `Blockchain` without a scheme fails to compile, and validation reads its
 * keys, so a chain the type knows is a chain the QR route will draw.
 */
const PAYMENT_SCHEMES: Record<Blockchain, string> = {
  BTC: 'bitcoin',
  BCH: 'bitcoincash',
  ETH: 'ethereum',
  POL: 'ethereum', // EIP-681: all EVM chains use ethereum: scheme with chain ID
  SOL: 'solana',
  DOGE: 'dogecoin',
  XRP: 'ripple',
  ADA: 'web+cardano', // CIP-13 Cardano URI scheme
  BNB: 'ethereum', // BNB Chain is EVM compatible
  USDT: 'ethereum', // USDT is ERC-20
  USDT_ETH: 'ethereum',
  USDT_POL: 'ethereum',
  USDT_SOL: 'solana',
  USDT_TRON: 'tron', // unused: a TRON code is the bare address
  USDC: 'ethereum', // USDC is ERC-20
  USDC_ETH: 'ethereum',
  USDC_POL: 'ethereum', // EIP-681: all EVM chains use ethereum: scheme with chain ID
  USDC_SOL: 'solana',
  USDC_BASE: 'ethereum', // EIP-681 with chain ID 8453
};

/**
 * Check if blockchain is an EVM chain
 */
function isEVMChain(blockchain: Blockchain): boolean {
  return PAYMENT_SCHEMES[blockchain] === 'ethereum';
}

/**
 * Check if blockchain is a token (not native coin)
 */
function isToken(blockchain: Blockchain): boolean {
  return blockchain in TOKEN_CONTRACTS;
}

/**
 * Convert amount to smallest unit (wei, lamports, satoshi, etc.)
 */
function toSmallestUnit(amount: number, blockchain: Blockchain): string {
  const decimals = TOKEN_DECIMALS[blockchain] || 18;
  const multiplier = BigInt(10) ** BigInt(decimals);
  // Use string manipulation to avoid floating point precision issues
  // A small amount stringifies as "1e-7", which BigInt rejects. Only then use
  // toFixed: on ordinary amounts it exposes float noise (5.021507 -> ...6999721).
  let text = amount.toString();
  if (/e/i.test(text)) text = amount.toFixed(decimals);
  const [whole, fraction = ''] = text.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const smallestUnit = BigInt(whole) * multiplier + BigInt(paddedFraction);
  return smallestUnit.toString();
}

/**
 * Build payment URI for cryptocurrency
 * Following standards:
 * - BIP21 for Bitcoin/BCH
 * - EIP-681 for Ethereum/EVM chains
 * - Solana Pay for Solana
 *
 * @param params - Payment parameters
 * @returns Payment URI string
 */
function buildPaymentURI(params: PaymentQRParams): string {
  const { blockchain, address, amount, label, message } = params;

  // Get URI scheme
  const scheme = getPaymentScheme(blockchain);

  // TRON has no payment-URI standard that wallets agree on for a TRC-20
  // amount (TronLink, Trust and Exodus all read a bare address), so the code
  // carries only the address and the page shows the exact amount to send.
  if (blockchain === 'USDT_TRON') {
    return address;
  }

  // Handle EVM chains (ETH, POL, USDC_ETH, USDC_POL) - EIP-681 format
  if (isEVMChain(blockchain)) {
    return buildEIP681URI(params);
  }

  // Handle Solana chains - Solana Pay format
  if (PAYMENT_SCHEMES[blockchain] === 'solana') {
    return buildSolanaPayURI(params);
  }

  // Handle Bitcoin/BCH - BIP21 format
  let uri = `${scheme}:${address}`;
  const queryParams: string[] = [];

  if (amount) {
    queryParams.push(`amount=${amount}`);
  }

  if (label) {
    queryParams.push(`label=${encodeURIComponent(label)}`);
  }

  if (message) {
    queryParams.push(`message=${encodeURIComponent(message)}`);
  }

  if (queryParams.length > 0) {
    uri += `?${queryParams.join('&')}`;
  }

  return uri;
}

/**
 * Build EIP-681 compliant URI for EVM chains
 * Format for native tokens: ethereum:address@chainId?value=amountInWei
 * Format for ERC-20 tokens: ethereum:contractAddress@chainId/transfer?address=recipient&uint256=amount
 */
function buildEIP681URI(params: PaymentQRParams): string {
  const { blockchain, address, amount } = params;
  const chainId = CHAIN_IDS[blockchain];

  // For ERC-20 tokens (USDC), use transfer function call format
  if (isToken(blockchain) && TOKEN_CONTRACTS[blockchain]) {
    const contractAddress = TOKEN_CONTRACTS[blockchain];
    const amountInSmallestUnit = toSmallestUnit(amount, blockchain);

    // EIP-681 format for ERC-20 transfer
    // ethereum:tokenContract@chainId/transfer?address=recipient&uint256=amount
    return `ethereum:${contractAddress}@${chainId}/transfer?address=${address}&uint256=${amountInSmallestUnit}`;
  }

  // For native tokens (ETH, POL), use simple value transfer format
  const amountInWei = toSmallestUnit(amount, blockchain);

  // EIP-681 format: ethereum:address@chainId?value=amountInWei
  return `ethereum:${address}@${chainId}?value=${amountInWei}`;
}

/**
 * Build Solana Pay compliant URI
 * Format for SOL: solana:address?amount=amount
 * Format for SPL tokens: solana:address?amount=amount&spl-token=mintAddress
 */
function buildSolanaPayURI(params: PaymentQRParams): string {
  const { blockchain, address, amount, label, message } = params;

  let uri = `solana:${address}`;
  const queryParams: string[] = [];

  if (amount) {
    queryParams.push(`amount=${amount}`);
  }

  // Add SPL token mint address for USDC
  if (blockchain !== 'SOL' && TOKEN_CONTRACTS[blockchain]) {
    queryParams.push(`spl-token=${TOKEN_CONTRACTS[blockchain]}`);
  }

  if (label) {
    queryParams.push(`label=${encodeURIComponent(label)}`);
  }

  if (message) {
    queryParams.push(`message=${encodeURIComponent(message)}`);
  }

  if (queryParams.length > 0) {
    uri += `?${queryParams.join('&')}`;
  }

  return uri;
}

/**
 * Validate payment QR parameters
 */
function validatePaymentParams(params: PaymentQRParams): void {
  if (!Object.prototype.hasOwnProperty.call(PAYMENT_SCHEMES, params.blockchain)) {
    throw new Error(`Invalid blockchain: ${params.blockchain}`);
  }

  if (!params.address || params.address.length === 0) {
    throw new Error('Address cannot be empty');
  }

  if (params.amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }
}

/**
 * Generate a payment QR code
 * @param params - Payment parameters
 * @param options - QR code options
 * @returns Data URL of payment QR code
 */
export async function generatePaymentQR(
  params: PaymentQRParams,
  options: QROptions = {}
): Promise<string> {
  try {
    // Validate parameters
    validatePaymentParams(params);

    // Build payment URI
    const paymentURI = buildPaymentURI(params);

    // Generate QR code
    const dataURL = await generateQRCode(paymentURI, options);
    
    return dataURL;
  } catch (error) {
    throw new Error(
      `Payment QR generation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Generate QR code as SVG string
 * @param data - Data to encode
 * @param options - QR code options
 * @returns SVG string
 */
export async function generateQRCodeSVG(
  data: string,
  options: QROptions = {}
): Promise<string> {
  try {
    if (!data || data.length === 0) {
      throw new Error('Data cannot be empty');
    }

    const qrOptions = {
      ...DEFAULT_QR_OPTIONS,
      ...options,
    };

    const svg = await QRCode.toString(data, {
      ...qrOptions,
      type: 'svg',
    });
    
    return svg;
  } catch (error) {
    throw new Error(
      `QR code SVG generation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}
