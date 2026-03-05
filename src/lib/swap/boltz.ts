/**
 * Boltz Exchange API v2 client for BTC ↔ Lightning swaps
 * Docs: https://docs.boltz.exchange/v/api/v2
 * No API key needed — public, non-custodial submarine swaps.
 */

import crypto from 'crypto';

const BOLTZ_API = 'https://api.boltz.exchange/v2';

// --- Types ---

export interface BoltzSubmarinePairInfo {
  hash: string;
  rate: number;
  limits: { minimal: number; maximal: number; maximalZeroConf: number };
  fees: { percentage: number; minerFees: number };
}

export interface BoltzSwapResponse {
  id: string;
  bip21: string;
  address: string;
  expectedAmount: number;
  acceptZeroConf: boolean;
  timeoutBlockHeight: number;
  claimAddress?: string;
  redeemScript?: string;
  swapTree?: unknown;
}

export interface BoltzReverseSwapResponse {
  id: string;
  invoice: string;
  lockupAddress: string;
  timeoutBlockHeight: number;
  onchainAmount: number;
  redeemScript?: string;
  swapTree?: unknown;
}

export interface BoltzSwapStatus {
  status: string;
  transaction?: { id: string; hex?: string };
}

// --- Helpers ---

/** Generate an ephemeral keypair for refund/claim paths */
function generateKeyPair() {
  const keyPair = crypto.generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  // Extract raw 33-byte compressed public key from DER
  const derPub = Buffer.from(keyPair.publicKey);
  // DER SPKI for secp256k1 has a fixed header; the last 65 bytes are the uncompressed key
  const uncompressed = derPub.subarray(derPub.length - 65);
  const x = uncompressed.subarray(1, 33);
  const prefix = uncompressed[64] % 2 === 0 ? 0x02 : 0x03;
  const compressed = Buffer.concat([Buffer.from([prefix]), x]);
  return {
    publicKey: compressed.toString('hex'),
    privateKey: Buffer.from(keyPair.privateKey).toString('hex'),
  };
}

// --- API ---

/**
 * Get BTC→BTC submarine swap pair info (limits, fees)
 */
export async function getBoltzPairInfo(): Promise<BoltzSubmarinePairInfo> {
  const res = await fetch(`${BOLTZ_API}/swap/submarine`);
  if (!res.ok) throw new Error(`Boltz pairs failed: ${res.status}`);
  const data = await res.json();
  const pair = data?.BTC?.BTC;
  if (!pair) throw new Error('BTC/BTC submarine pair not found');
  return pair;
}

export async function getBoltzReversePairInfo() {
  const res = await fetch(`${BOLTZ_API}/swap/reverse`);
  if (!res.ok) throw new Error(`Boltz reverse pairs failed: ${res.status}`);
  const data = await res.json();
  const pair = data?.BTC?.BTC;
  if (!pair) throw new Error('BTC/BTC reverse pair not found');
  return pair;
}

/**
 * Create submarine swap: On-chain BTC → Lightning
 * User sends BTC to returned address, Boltz pays the invoice.
 */
export async function createSwapIn(
  invoice: string,
  refundAddress?: string,
): Promise<BoltzSwapResponse & { refundPrivateKey?: string }> {
  const kp = generateKeyPair();

  const body: Record<string, unknown> = {
    from: 'BTC',
    to: 'BTC',
    invoice,
    refundPublicKey: kp.publicKey,
  };

  const res = await fetch(`${BOLTZ_API}/swap/submarine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Boltz createswap failed: ${res.status} - ${err}`);
  }
  const swap = await res.json();
  return { ...swap, refundPrivateKey: kp.privateKey };
}

/**
 * Create reverse swap: Lightning → On-chain BTC
 * User pays LN invoice, Boltz sends BTC on-chain.
 */
export async function createSwapOut(
  invoiceAmount: number,
  claimAddress: string,
): Promise<BoltzReverseSwapResponse & { claimPrivateKey?: string }> {
  const kp = generateKeyPair();

  const body: Record<string, unknown> = {
    from: 'BTC',
    to: 'BTC',
    invoiceAmount,
    claimAddress,
    claimPublicKey: kp.publicKey,
  };

  const res = await fetch(`${BOLTZ_API}/swap/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Boltz reverse swap failed: ${res.status} - ${err}`);
  }
  const swap = await res.json();
  return { ...swap, claimPrivateKey: kp.privateKey };
}

/**
 * Check swap status
 */
export async function getSwapStatus(swapId: string): Promise<BoltzSwapStatus> {
  const res = await fetch(`${BOLTZ_API}/swap/${swapId}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Boltz status failed: ${res.status} - ${err}`);
  }
  return res.json();
}

/**
 * Estimate swap fees
 */
export async function estimateSwapFee(
  direction: 'in' | 'out',
  amountSats: number,
): Promise<{ totalFee: number; receiveSats: number; minerFee: number; serviceFee: number }> {
  if (direction === 'in') {
    const pair = await getBoltzPairInfo();
    const serviceFee = Math.ceil(amountSats * (pair.fees.percentage / 100));
    const minerFee = pair.fees.minerFees;
    const totalFee = serviceFee + minerFee;
    return { totalFee, receiveSats: amountSats - totalFee, minerFee, serviceFee };
  } else {
    const pair = await getBoltzReversePairInfo();
    const serviceFee = Math.ceil(amountSats * (pair.fees.percentage / 100));
    const minerFee = pair.fees.minerFees?.claim + pair.fees.minerFees?.lockup || 0;
    const totalFee = serviceFee + minerFee;
    return { totalFee, receiveSats: amountSats - totalFee, minerFee, serviceFee };
  }
}
