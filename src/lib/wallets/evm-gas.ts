/**
 * Gas strategy for EVM token forwards.
 *
 * An ERC20 transfer is paid for in the chain's native currency by the *sending*
 * address. CoinPay's derived payment addresses only ever receive the token, so
 * a plain `token.transfer()` from one of them reverts on intrinsic gas cost —
 * which is how token payments came to strand at intermediary addresses while
 * every surface reported them received.
 *
 * Two ways out, tried in order:
 *
 *   1. RELAYER (preferred). EIP-2612 `permit` lets the address authorise a
 *      spender with an off-chain signature — no gas, and we already hold its
 *      key. The relayer then calls `transferFrom` and pays the gas itself. No
 *      native currency ever touches the derived address, so nothing is
 *      stranded and no dust is left behind at hundreds of one-shot addresses.
 *
 *   2. TOP-UP (fallback). For tokens without `permit` — notably USDT on
 *      Ethereum, which predates the standard — the relayer sends the derived
 *      address just enough native currency to cover the transfer, then the
 *      address sends the tokens itself. Leaves a little dust behind, which is
 *      the price of supporting those tokens at all.
 *
 * Either way the platform advances the gas. It is reimbursed from the network
 * fee already added to every quote (see computeGasReserve), so this is a float
 * rather than a subsidy — provided that reserve is withheld before the
 * merchant/platform split.
 */

import { ethers } from 'ethers';
import { deriveGasRelayerWallet } from './system-wallet';
import type { SystemBlockchain } from './system-wallet';

/** Enough for an ERC20 transfer/transferFrom on any of the chains we support. */
export const TOKEN_TRANSFER_GAS_LIMIT = 120_000n;
/** `permit` is cheaper than a transfer but not free. */
export const PERMIT_GAS_LIMIT = 100_000n;

/**
 * Headroom on the gas top-up. Gas price can rise between funding the address
 * and spending from it; under-funding strands the payment a second time, and
 * the leftover is pennies.
 */
const TOPUP_BUFFER_MULTIPLIER = 3n;

export const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
];

export interface GasRelayer {
  wallet: ethers.Wallet;
  address: string;
  balance: bigint;
}

/**
 * The relayer for a chain, connected to a provider, with its balance read.
 * Callers decide whether the balance is sufficient — a relayer that is broke is
 * still worth reporting on, because "top up the float" is the actionable error.
 */
export async function getGasRelayer(
  cryptocurrency: SystemBlockchain,
  provider: ethers.Provider,
): Promise<GasRelayer> {
  const { privateKey, address } = deriveGasRelayerWallet(cryptocurrency);
  const wallet = new ethers.Wallet(`0x${privateKey.replace(/^0x/, '')}`, provider);
  const balance = await provider.getBalance(address);
  return { wallet, address, balance };
}

/** Current gas price, preferring EIP-1559 fields where the chain exposes them. */
export async function currentGasPrice(provider: ethers.Provider): Promise<bigint> {
  const fee = await provider.getFeeData();
  return fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
}

/**
 * Resolve the EIP-712 domain a token actually uses for `permit`.
 *
 * The domain must match the token's own `DOMAIN_SEPARATOR()` exactly or the
 * signature is rejected on-chain, and tokens disagree about the `version`
 * field ("1" vs "2") with no reliable way to read it — `version()` is not part
 * of EIP-2612 and many deployments omit it. So rather than guess, build each
 * candidate domain, hash it, and keep the one the contract confirms. A token
 * that matches nothing does not support permit as far as we are concerned.
 */
export async function resolvePermitDomain(
  token: ethers.Contract,
  chainId: bigint,
): Promise<ethers.TypedDataDomain | null> {
  let onChainSeparator: string;
  let name: string;
  try {
    [onChainSeparator, name] = await Promise.all([
      token.DOMAIN_SEPARATOR(),
      token.name(),
    ]);
  } catch {
    return null; // no DOMAIN_SEPARATOR/name → not an EIP-2612 token
  }

  const verifyingContract = await token.getAddress();
  const candidates: ethers.TypedDataDomain[] = [];

  // Some tokens expose version() — try it first, then the common literals.
  let declaredVersion: string | null = null;
  try {
    declaredVersion = await token.version();
  } catch {
    /* not exposed */
  }
  for (const version of [declaredVersion, '1', '2'].filter(Boolean) as string[]) {
    candidates.push({ name, version, chainId, verifyingContract });
    // Polygon's bridged tokens use a salt-based domain with no chainId field.
    candidates.push({
      name,
      version,
      verifyingContract,
      salt: ethers.zeroPadValue(ethers.toBeHex(chainId), 32),
    });
  }

  for (const domain of candidates) {
    try {
      if (ethers.TypedDataEncoder.hashDomain(domain) === onChainSeparator) return domain;
    } catch {
      /* malformed candidate — keep looking */
    }
  }
  return null;
}

export interface RelayedTransferResult {
  txHashes: string[];
  relayerAddress: string;
  gasSpentWei: bigint;
}

/**
 * Move tokens out of `owner` without `owner` ever holding native currency.
 *
 * Signs an EIP-2612 permit with the owner's key (off-chain, free), then has the
 * relayer pull the funds with `transferFrom`. Returns null — rather than
 * throwing — when the token does not support permit, so the caller can fall
 * back to the top-up path without treating it as an error.
 */
export async function forwardTokenViaRelayer(params: {
  cryptocurrency: SystemBlockchain;
  provider: ethers.Provider;
  ownerPrivateKey: string;
  tokenAddress: string;
  recipients: Array<{ address: string; amount: bigint }>;
}): Promise<RelayedTransferResult | null> {
  const { cryptocurrency, provider, ownerPrivateKey, tokenAddress, recipients } = params;

  const owner = new ethers.Wallet(
    ownerPrivateKey.startsWith('0x') ? ownerPrivateKey : `0x${ownerPrivateKey}`,
    provider,
  );
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const { chainId } = await provider.getNetwork();

  const domain = await resolvePermitDomain(token, chainId);
  if (!domain) return null;

  const relayer = await getGasRelayer(cryptocurrency, provider);
  const total = recipients.reduce((sum, r) => sum + r.amount, 0n);
  if (total <= 0n) return null;

  // permit + one transferFrom per recipient.
  const gasPrice = await currentGasPrice(provider);
  const estimated =
    (PERMIT_GAS_LIMIT + TOKEN_TRANSFER_GAS_LIMIT * BigInt(recipients.length)) * gasPrice;
  if (relayer.balance < estimated) {
    throw new Error(
      `Gas relayer ${relayer.address} has ${ethers.formatEther(relayer.balance)} but needs ` +
        `~${ethers.formatEther(estimated)} for ${cryptocurrency}. Top up the relayer.`,
    );
  }

  const nonce: bigint = await token.nonces(owner.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signature = await owner.signTypedData(
    domain,
    {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    { owner: owner.address, spender: relayer.address, value: total, nonce, deadline },
  );
  const { v, r, s } = ethers.Signature.from(signature);

  const relayerToken = token.connect(relayer.wallet) as ethers.Contract;
  const txHashes: string[] = [];
  let gasSpentWei = 0n;

  const permitTx = await relayerToken.permit(
    owner.address, relayer.address, total, deadline, v, r, s,
    { gasLimit: PERMIT_GAS_LIMIT },
  );
  const permitReceipt = await permitTx.wait();
  if (!permitReceipt || permitReceipt.status !== 1) {
    throw new Error(`permit reverted for ${owner.address} (${permitTx.hash})`);
  }
  gasSpentWei += BigInt(permitReceipt.gasUsed) * BigInt(permitReceipt.gasPrice ?? 0);

  for (const recipient of recipients) {
    if (recipient.amount <= 0n) continue;
    const tx = await relayerToken.transferFrom(
      owner.address, recipient.address, recipient.amount,
      { gasLimit: TOKEN_TRANSFER_GAS_LIMIT },
    );
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`transferFrom reverted paying ${recipient.address} (${tx.hash})`);
    }
    gasSpentWei += BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? 0);
    txHashes.push(tx.hash);
  }

  return { txHashes, relayerAddress: relayer.address, gasSpentWei };
}

/**
 * Fallback for tokens without `permit`: send the derived address enough native
 * currency to pay for its own transfers.
 *
 * Returns the top-up transaction hash, or null when the address already has
 * enough. Throws with an actionable message when the relayer itself is broke —
 * that is an operational problem (top up the float), not a payment problem.
 */
export async function ensureGasForTransfers(params: {
  cryptocurrency: SystemBlockchain;
  provider: ethers.Provider;
  address: string;
  transferCount: number;
}): Promise<string | null> {
  const { cryptocurrency, provider, address, transferCount } = params;

  const gasPrice = await currentGasPrice(provider);
  const needed = TOKEN_TRANSFER_GAS_LIMIT * BigInt(Math.max(1, transferCount)) * gasPrice;
  const balance = await provider.getBalance(address);
  if (balance >= needed) return null;

  const shortfall = (needed - balance) * TOPUP_BUFFER_MULTIPLIER;
  const relayer = await getGasRelayer(cryptocurrency, provider);

  // The relayer needs the top-up *and* gas to send it.
  const sendCost = 21_000n * gasPrice;
  if (relayer.balance < shortfall + sendCost) {
    throw new Error(
      `Gas relayer ${relayer.address} has ${ethers.formatEther(relayer.balance)} but needs ` +
        `~${ethers.formatEther(shortfall + sendCost)} to fund ${address} on ${cryptocurrency}. ` +
        `Top up the relayer.`,
    );
  }

  const tx = await relayer.wallet.sendTransaction({ to: address, value: shortfall });
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Gas top-up to ${address} failed (${tx.hash})`);
  }
  console.log(
    `[GAS] Topped up ${address} with ${ethers.formatEther(shortfall)} from relayer ${relayer.address} (${tx.hash})`,
  );
  return tx.hash;
}

/**
 * The slice of a token payment that belongs to the platform as reimbursement
 * for gas, in token units.
 *
 * Every quote already adds an estimated network fee on top of the invoice
 * amount (see createPayment), so the payer has funded this. On chains where the
 * fee and the funds are the same asset — BTC, SOL, native ETH — it is consumed
 * automatically by the sweep. For tokens it arrives as more *token*, which
 * cannot pay gas, so it has to be withheld here and handed to the platform
 * instead of being split 99/1 with the merchant. Withholding it is what makes
 * the relayer float self-sustaining rather than a subsidy.
 *
 * Returns 0 when the metadata does not describe a surcharge, which keeps older
 * payments splitting exactly as they do today.
 */
export function computeGasReserve(
  cryptoAmount: number,
  metadata: Record<string, unknown> | null | undefined,
): number {
  const feeUsd = Number(metadata?.network_fee_usd);
  const totalUsd = Number(metadata?.total_amount_usd);
  if (![feeUsd, totalUsd, cryptoAmount].every(Number.isFinite)) return 0;
  if (feeUsd <= 0 || totalUsd <= 0 || cryptoAmount <= 0) return 0;

  const reserve = cryptoAmount * (feeUsd / totalUsd);
  // Guard against malformed metadata turning a payment into all-fee.
  return Math.min(reserve, cryptoAmount * 0.5);
}
