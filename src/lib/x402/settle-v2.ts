/**
 * x402 v2 settlement — broadcasting an EIP-3009 authorization.
 *
 * The v1 rail settles by looking up a transaction the payer already broadcast.
 * v2 inverts that: the payer signed and broadcast nothing, so settling IS the
 * broadcast. We call `transferWithAuthorization` on the token, the token
 * verifies the signature itself and moves the funds from payer to payee, and
 * the relayer pays the gas.
 *
 * That is what lets a payer with no native currency buy something — the whole
 * reason the ecosystem settled on EIP-3009 for the `exact` scheme.
 *
 * The funds go payer -> payee directly. No CoinPayPortal wallet is in the
 * path, so as on the v1 rail the platform fee is not collected here; see the
 * header of src/app/api/x402/settle/route.ts.
 */

import { ethers } from 'ethers';
import { getGasRelayer } from '@/lib/wallets/evm-gas';
import type { SystemBlockchain } from '@/lib/wallets/system-wallet';
import { evmChainId, type V2Authorization } from './v2';

/**
 * `transferWithAuthorization` in its (v, r, s) form.
 *
 * EIP-3009 also defines a variant taking a packed 65-byte signature, but the
 * split form is the one every major deployment exposes, so it is what is used.
 */
export const EIP3009_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
];

/** Gas limit for a `transferWithAuthorization` call. */
export const TRANSFER_WITH_AUTHORIZATION_GAS_LIMIT = 150_000n;

/** Which system wallet family funds the relayer on a given chain. */
const CHAIN_TO_SYSTEM_WALLET: Record<number, SystemBlockchain> = {
  1: 'ETH',
  137: 'POL',
  8453: 'ETH', // Base derives from the ETH family
};

const RPC_BY_CHAIN_ID: Record<number, string | undefined> = {
  1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  137: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
};

export interface SettleV2Result {
  txHash: string;
  relayerAddress: string;
  confirmed: boolean;
}

/**
 * Broadcast an authorization, moving the funds.
 *
 * @param network        CAIP-2 id, or a legacy bare name
 * @param asset          token contract address
 * @param authorization  the signed EIP-3009 authorization
 * @param signature      the payer's 65-byte signature over it
 */
export async function settleExactEvmV2({
  network,
  asset,
  authorization,
  signature,
}: {
  network: string;
  asset: string;
  authorization: V2Authorization;
  signature: string;
}): Promise<SettleV2Result> {
  const chainId = evmChainId(network);
  if (chainId === null) throw new Error(`Not an EVM network: ${network}`);

  const rpcUrl = RPC_BY_CHAIN_ID[chainId];
  if (!rpcUrl) throw new Error(`No RPC configured for chain ${chainId}`);

  const family = CHAIN_TO_SYSTEM_WALLET[chainId];
  if (!family) throw new Error(`No relayer configured for chain ${chainId}`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const relayer = await getGasRelayer(family, provider);

  const token = new ethers.Contract(asset, EIP3009_ABI, relayer.wallet);

  // Refuse early if the token has already seen this nonce. Broadcasting anyway
  // would burn gas on a call the token reverts, and the revert reason is
  // indistinguishable from a malformed signature once it comes back.
  try {
    const used = await token.authorizationState(authorization.from, authorization.nonce);
    if (used) {
      throw new Error('Authorization has already been used on-chain');
    }
  } catch (err) {
    // A token that does not expose authorizationState is still settleable —
    // only re-throw our own refusal.
    if ((err as Error).message?.includes('already been used')) throw err;
  }

  // Split the signature. `ethers.Signature.from` validates the shape and
  // normalises `v`, which wallets emit as either 0/1 or 27/28.
  let sig: ethers.Signature;
  try {
    sig = ethers.Signature.from(signature);
  } catch (err) {
    throw new Error(`Malformed signature: ${(err as Error).message}`);
  }

  const estimatedCost = await estimateCost(provider);
  if (relayer.balance < estimatedCost) {
    throw new Error(
      `Gas relayer ${relayer.address} has ${ethers.formatEther(relayer.balance)} on chain ` +
        `${chainId}, needs about ${ethers.formatEther(estimatedCost)} — top up the float`,
    );
  }

  const tx = await token.transferWithAuthorization(
    authorization.from,
    authorization.to,
    authorization.value,
    authorization.validAfter,
    authorization.validBefore,
    authorization.nonce,
    sig.v,
    sig.r,
    sig.s,
    { gasLimit: TRANSFER_WITH_AUTHORIZATION_GAS_LIMIT },
  );

  const receipt = await tx.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Authorization transfer reverted (tx ${tx.hash})`);
  }

  return { txHash: tx.hash, relayerAddress: relayer.address, confirmed: true };
}

async function estimateCost(provider: ethers.Provider): Promise<bigint> {
  const fee = await provider.getFeeData();
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  return price * TRANSFER_WITH_AUTHORIZATION_GAS_LIMIT;
}
