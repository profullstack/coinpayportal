import QRCode from 'qrcode';

/**
 * Supported blockchain types
 */
export type Blockchain =
  | 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL'
  | 'DOGE' | 'XRP' | 'ADA' | 'BNB'
  | 'USDT' | 'USDC'
  | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';

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
  USDC_ETH: 1,
  USDC_POL: 137,
};

/**
 * Token contract addresses for ERC-20/SPL tokens
 */
const TOKEN_CONTRACTS: Record<string, string> = {
  // USDC on Ethereum mainnet
  USDC_ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  // USDC on Polygon mainnet (native USDC)
  USDC_POL: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  // USDC on Solana (SPL token mint address)
  USDC_SOL: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
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
  USDC: 6,
  USDC_ETH: 6,
  USDC_POL: 6,
  USDC_SOL: 6,
};

/**
 * Get payment URI scheme for blockchain
 */
function getPaymentScheme(blockchain: Blockchain): string {
  const schemes: Record<Blockchain, string> = {
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
    USDC: 'ethereum', // USDC is ERC-20
    USDC_ETH: 'ethereum',
    USDC_POL: 'ethereum', // EIP-681: all EVM chains use ethereum: scheme with chain ID
    USDC_SOL: 'solana',
  };

  return schemes[blockchain];
}

/**
 * Check if blockchain is an EVM chain
 */
function isEVMChain(blockchain: Blockchain): boolean {
  return ['ETH', 'POL', 'BNB', 'USDT', 'USDC', 'USDC_ETH', 'USDC_POL'].includes(blockchain);
}

/**
 * Check if blockchain is a token (not native coin)
 */
function isToken(blockchain: Blockchain): boolean {
  return ['USDC_ETH', 'USDC_POL', 'USDC_SOL'].includes(blockchain);
}

/**
 * Convert amount to smallest unit (wei, lamports, satoshi, etc.)
 */
function toSmallestUnit(amount: number, blockchain: Blockchain): string {
  const decimals = TOKEN_DECIMALS[blockchain] || 18;
  const multiplier = BigInt(10 ** decimals);
  // Use string manipulation to avoid floating point precision issues
  const [whole, fraction = ''] = amount.toString().split('.');
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

  // Handle EVM chains (ETH, POL, USDC_ETH, USDC_POL) - EIP-681 format
  if (isEVMChain(blockchain)) {
    return buildEIP681URI(params);
  }

  // Handle Solana chains - Solana Pay format
  if (blockchain === 'SOL' || blockchain === 'USDC_SOL') {
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
  if (blockchain === 'USDC_SOL' && TOKEN_CONTRACTS[blockchain]) {
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
  const validBlockchains: Blockchain[] = [
    'BTC', 'BCH', 'ETH', 'POL', 'SOL',
    'DOGE', 'XRP', 'ADA', 'BNB',
    'USDT', 'USDC',
    'USDC_ETH', 'USDC_POL', 'USDC_SOL',
  ];

  if (!validBlockchains.includes(params.blockchain)) {
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