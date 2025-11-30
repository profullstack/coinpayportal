import QRCode from 'qrcode';

/**
 * Supported blockchain types
 */
export type Blockchain =
  | 'BTC'
  | 'BCH'
  | 'ETH'
  | 'POL'
  | 'SOL'
  | 'USDC_ETH'
  | 'USDC_POL'
  | 'USDC_SOL';

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
 * Get payment URI scheme for blockchain
 */
function getPaymentScheme(blockchain: Blockchain): string {
  const schemes: Record<Blockchain, string> = {
    BTC: 'bitcoin',
    BCH: 'bitcoincash',
    ETH: 'ethereum',
    POL: 'polygon',
    SOL: 'solana',
    USDC_ETH: 'ethereum',
    USDC_POL: 'polygon',
    USDC_SOL: 'solana',
  };

  return schemes[blockchain];
}

/**
 * Build payment URI for cryptocurrency
 * @param params - Payment parameters
 * @returns Payment URI string
 */
function buildPaymentURI(params: PaymentQRParams): string {
  const { blockchain, address, amount, label, message } = params;

  // Get URI scheme
  const scheme = getPaymentScheme(blockchain);
  
  // Build base URI
  let uri = `${scheme}:${address}`;

  // Add query parameters
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

  // Append query string if there are parameters
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
    'BTC',
    'BCH',
    'ETH',
    'POL',
    'SOL',
    'USDC_ETH',
    'USDC_POL',
    'USDC_SOL',
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