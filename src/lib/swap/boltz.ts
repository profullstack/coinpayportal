/**
 * Boltz Exchange API client for BTC ↔ Lightning swaps
 * Docs: https://docs.boltz.exchange/v/api
 * No API key needed — public, non-custodial submarine swaps.
 */

const BOLTZ_API_URL = 'https://api.boltz.exchange';

export interface BoltzPairInfo {
  rate: number;
  limits: {
    minimal: number;
    maximal: number;
  };
  fees: {
    percentage: number;
    percentageSwapIn: number;
    minerFees: {
      baseAsset: {
        normal: number;
        reverse: { claim: number; lockup: number };
      };
      quoteAsset: {
        normal: number;
        reverse: { claim: number; lockup: number };
      };
    };
  };
}

export interface BoltzSwapResponse {
  id: string;
  bip21?: string;
  address?: string;
  expectedAmount?: number;
  acceptZeroConf?: boolean;
  timeoutBlockHeight?: number;
  redeemScript?: string;
}

export interface BoltzReverseSwapResponse {
  id: string;
  invoice: string;
  redeemScript: string;
  lockupAddress: string;
  timeoutBlockHeight: number;
  onchainAmount: number;
}

export interface BoltzSwapStatus {
  status: string;
  transaction?: {
    id: string;
    hex?: string;
  };
}

/**
 * Get BTC/BTC pair info (on-chain ↔ Lightning limits, fees, rates)
 */
export async function getBoltzPairInfo(): Promise<BoltzPairInfo> {
  const res = await fetch(`${BOLTZ_API_URL}/getpairs`);
  if (!res.ok) throw new Error(`Boltz getpairs failed: ${res.status}`);
  const data = await res.json();
  const pair = data.pairs?.['BTC/BTC'];
  if (!pair) throw new Error('BTC/BTC pair not found on Boltz');
  return pair;
}

/**
 * Create a Normal Swap: On-chain BTC → Lightning
 * User sends BTC to the returned address, Boltz pays the Lightning invoice.
 *
 * @param invoice - Lightning invoice (BOLT11) to be paid by Boltz
 * @param refundAddress - On-chain BTC address for refunds if swap fails
 */
export async function createSwapIn(invoice: string, refundAddress?: string): Promise<BoltzSwapResponse> {
  const body: Record<string, unknown> = {
    type: 'submarine',
    pairId: 'BTC/BTC',
    orderSide: 'sell',
    invoice,
  };
  if (refundAddress) body.refundAddress = refundAddress;

  const res = await fetch(`${BOLTZ_API_URL}/createswap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Boltz createswap failed: ${res.status} - ${err}`);
  }
  return res.json();
}

/**
 * Create a Reverse Swap: Lightning → On-chain BTC
 * User pays a Lightning invoice, Boltz sends BTC to the on-chain address.
 *
 * @param onchainAmount - Amount in sats to receive on-chain
 * @param claimAddress - On-chain BTC address to receive funds
 */
export async function createSwapOut(
  onchainAmount: number,
  claimAddress: string,
  preimageHash?: string,
): Promise<BoltzReverseSwapResponse> {
  const body: Record<string, unknown> = {
    type: 'reversesubmarine',
    pairId: 'BTC/BTC',
    orderSide: 'buy',
    onchainAmount,
    claimAddress,
  };
  if (preimageHash) body.preimageHash = preimageHash;

  const res = await fetch(`${BOLTZ_API_URL}/createswap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Boltz reverse swap failed: ${res.status} - ${err}`);
  }
  return res.json();
}

/**
 * Check swap status
 */
export async function getSwapStatus(swapId: string): Promise<BoltzSwapStatus> {
  const res = await fetch(`${BOLTZ_API_URL}/swapstatus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: swapId }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Boltz swapstatus failed: ${res.status} - ${err}`);
  }
  return res.json();
}

/**
 * Get fee estimation for a swap
 */
export async function estimateSwapFee(
  direction: 'in' | 'out',
  amountSats: number,
): Promise<{ totalFee: number; receiveSats: number; minerFee: number; serviceFee: number }> {
  const pair = await getBoltzPairInfo();

  if (direction === 'in') {
    // On-chain → Lightning: user sends BTC, receives Lightning sats
    const serviceFee = Math.ceil(amountSats * (pair.fees.percentageSwapIn / 100));
    const minerFee = pair.fees.minerFees.baseAsset.normal;
    const totalFee = serviceFee + minerFee;
    return {
      totalFee,
      receiveSats: amountSats - totalFee,
      minerFee,
      serviceFee,
    };
  } else {
    // Lightning → On-chain: user pays LN invoice, receives on-chain BTC
    const serviceFee = Math.ceil(amountSats * (pair.fees.percentage / 100));
    const minerFee = pair.fees.minerFees.baseAsset.reverse.claim + pair.fees.minerFees.baseAsset.reverse.lockup;
    const totalFee = serviceFee + minerFee;
    return {
      totalFee,
      receiveSats: amountSats - totalFee,
      minerFee,
      serviceFee,
    };
  }
}
