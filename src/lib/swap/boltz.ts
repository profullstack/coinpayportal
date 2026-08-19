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
/**
 * Confirm a lockup address really encodes the redeem script Boltz returned.
 *
 * W-06: `redeemScript` and `swapTree` were declared on both response types and
 * never read. The lockup address was taken on faith, so a substituted address —
 * from a compromised endpoint or a hostile proxy — would have been funded
 * happily, and the refund key we generated locally would be worthless against
 * it, because it belongs to a DIFFERENT script. The deposit would be
 * unrecoverable.
 *
 * A redeem script pins the address: hashing it reproduces the P2WSH (or
 * P2SH-wrapped) address exactly. If they disagree, the address did not come
 * from that script and the swap must not be funded.
 *
 * Taproot swaps carry a `swapTree` instead, whose derivation needs the full
 * tweak and is not reproduced here — those return `null` for "cannot check"
 * rather than a false pass.
 */
export async function lockupAddressMatchesScript(
  address: string,
  redeemScript: string | undefined,
): Promise<boolean | null> {
  if (!redeemScript) return null;

  const bitcoin = await import('bitcoinjs-lib');
  const network = bitcoin.networks.bitcoin;

  let script: Buffer;
  try {
    script = Buffer.from(redeemScript, 'hex');
  } catch {
    return false;
  }
  if (script.length === 0) return false;

  const candidates: string[] = [];
  const push = (fn: () => string | undefined) => {
    try {
      const a = fn();
      if (a) candidates.push(a);
    } catch {
      /* not this form */
    }
  };

  // Native segwit P2WSH — what Boltz uses for current submarine swaps.
  push(() => bitcoin.payments.p2wsh({ redeem: { output: script, network }, network }).address);
  // P2SH-wrapped P2WSH, and bare P2SH, for older swaps.
  push(() =>
    bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wsh({ redeem: { output: script, network }, network }),
      network,
    }).address
  );
  push(() => bitcoin.payments.p2sh({ redeem: { output: script, network }, network }).address);

  if (candidates.length === 0) return null;
  return candidates.includes(address);
}

/**
 * Throw unless the lockup address is provably the one the redeem script
 * describes. A swap we cannot verify is refused rather than funded on trust.
 */
function assertLockupBinding(kind: string, address: string, matched: boolean | null): void {
  if (matched === false) {
    throw new Error(
      `Boltz ${kind}: lockup address ${address} does not match the redeem script returned with it - refusing to fund`
    );
  }
}

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

  // The address we are about to tell a user to fund must be the one the redeem
  // script describes. Our refund key only works against that script.
  const matched = await lockupAddressMatchesScript(swap.address, swap.redeemScript);
  assertLockupBinding('submarine swap', swap.address, matched);
  if (matched === null) {
    console.warn(
      `[Boltz] Swap ${swap.id} returned no redeemScript - lockup address ${swap.address} could not be verified against a script`
    );
  }

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

  const matched = await lockupAddressMatchesScript(swap.lockupAddress, swap.redeemScript);
  assertLockupBinding('reverse swap', swap.lockupAddress, matched);
  if (matched === null) {
    console.warn(
      `[Boltz] Reverse swap ${swap.id} returned no redeemScript - lockup address ${swap.lockupAddress} could not be verified against a script`
    );
  }

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
