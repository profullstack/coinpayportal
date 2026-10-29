/**
 * Keeping the gas relayer float visible.
 *
 * Every EVM token sweep is paid for by the gas relayer (see evm-gas.ts). When
 * it runs dry, every token payment on that chain confirms and then cannot be
 * forwarded, and nothing told anyone: on 2026-09-24 (Ethereum) and 2026-10-13
 * (Polygon) a customer's money sat at its deposit address until somebody
 * noticed the merchant had not been paid.
 *
 * Two alarms:
 *   - alertRelayerUnderfunded — a sweep was just deferred for lack of gas.
 *   - checkRelayerFloats      — run from the cron, warns while there is still
 *                               room for a few sweeps, before one is deferred.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { escapeHtml } from '@/lib/email/escape';
import { getRpcUrl } from '@/lib/blockchain/providers';
import { claimOpsSlot, sendOpsAlert } from '@/lib/ops/alerts';
import {
  PERMIT_GAS_LIMIT,
  TOKEN_TRANSFER_GAS_LIMIT,
  currentGasPrice,
  type RelayerUnderfundedError,
} from './evm-gas';
import { Connection, PublicKey } from '@solana/web3.js';
import { deriveGasRelayerWallet, deriveSolanaFeePayer, deriveTronRelayerWallet, isUsdtTronEnabled, type SystemBlockchain } from './system-wallet';
import { operatorKeysLocked, refreshOperatorState } from './operator-keys';
import { getTrxBalanceSun, SUN_PER_TRX } from '@/lib/tron/client';

const HOUR = 60 * 60 * 1000;

/** One token chain per network: the relayer address and gas price are per network. */
export const RELAYER_NETWORKS: Array<{ network: string; chain: SystemBlockchain; native: string }> = [
  { network: 'Ethereum', chain: 'USDC_ETH', native: 'ETH' },
  { network: 'Polygon', chain: 'USDC_POL', native: 'POL' },
  { network: 'Base', chain: 'USDC_BASE', native: 'ETH' },
];

/** Warn while the float still covers this many sweeps (permit + two transferFroms each). */
export const RELAYER_WARN_SWEEPS = 10n;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function networkFor(chain: SystemBlockchain) {
  // TRON's relayer is not an EVM account, so it is not in RELAYER_NETWORKS
  // (the float check reads those with ethers); it still needs a label here.
  if (chain === 'USDT_TRON') return { network: 'TRON', chain, native: 'TRX' };
  return RELAYER_NETWORKS.find((n) => n.chain.split('_')[1] === chain.split('_')[1]);
}

export function sweepCostWei(gasPrice: bigint): bigint {
  return (PERMIT_GAS_LIMIT + TOKEN_TRANSFER_GAS_LIMIT * 2n) * gasPrice;
}

function alertHtml(lines: string[]): string {
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${lines
    .map((l) => `<p>${l}</p>`)
    .join('')}</div>`;
}

/** A sweep was deferred because the relayer could not pay for it. */
export async function alertRelayerUnderfunded(
  supabase: SupabaseClient,
  shortfall: RelayerUnderfundedError,
  paymentId: string,
): Promise<boolean> {
  const net = networkFor(shortfall.cryptocurrency);
  const label = net?.network ?? shortfall.cryptocurrency;
  const native = net?.native ?? 'native gas';
  return sendOpsAlert(supabase, {
    key: `relayer-underfunded:${label}`,
    throttleMs: 6 * HOUR,
    subject: `CoinPay: ${label} gas relayer is empty — payments are waiting to forward`,
    html: alertHtml([
      `A confirmed payment could not be forwarded to its merchant because the ${escapeHtml(label)} gas relayer cannot pay the network fee.`,
      `Relayer: <code>${escapeHtml(shortfall.relayerAddress)}</code><br>` +
        `Balance: ${escapeHtml(ethers.formatEther(shortfall.balanceWei))} ${native}<br>` +
        `Needed for this sweep: ~${escapeHtml(ethers.formatEther(shortfall.neededWei))} ${native}`,
      `First payment held: <code>${escapeHtml(paymentId)}</code>. Nothing was broadcast; the payment is back in ` +
        `<code>confirmed</code> and will forward on its own within a few minutes of the relayer being topped up.`,
      `Send ${native} on ${escapeHtml(label)} to the relayer address above.`,
    ]),
  });
}

export interface RelayerFloat {
  network: string;
  address: string;
  balanceWei: bigint;
  warnBelowWei: bigint;
  low: boolean;
}

/**
 * Read every relayer's balance and warn about the low ones. Runs at most once
 * per half hour across all processes; returns null when it was not this
 * caller's turn.
 */
export async function checkRelayerFloats(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<RelayerFloat[] | null> {
  // Sealed and locked operator keys: nothing to derive the relayers from,
  // and the operator-keys alert already says so. Skip quietly.
  if ((await refreshOperatorState()).sealed && operatorKeysLocked()) return null;
  if (!(await claimOpsSlot(supabase, 'check:relayer-floats', CHECK_INTERVAL_MS, now))) return null;

  const floats: RelayerFloat[] = [];
  for (const { network, chain, native } of RELAYER_NETWORKS) {
    try {
      const provider = new ethers.JsonRpcProvider(getRpcUrl(chain));
      const { address } = deriveGasRelayerWallet(chain);
      const [balanceWei, gasPrice] = await Promise.all([
        provider.getBalance(address),
        currentGasPrice(provider),
      ]);
      const warnBelowWei = sweepCostWei(gasPrice) * RELAYER_WARN_SWEEPS;
      const low = balanceWei < warnBelowWei;
      floats.push({ network, address, balanceWei, warnBelowWei, low });

      if (low) {
        await sendOpsAlert(supabase, {
          key: `relayer-low:${network}`,
          throttleMs: 12 * HOUR,
          subject: `CoinPay: ${network} gas relayer is low (${ethers.formatEther(balanceWei)} ${native})`,
          html: alertHtml([
            `The ${escapeHtml(network)} gas relayer pays the network fee for every token payment forwarded on that chain.`,
            `Relayer: <code>${escapeHtml(address)}</code><br>` +
              `Balance: ${escapeHtml(ethers.formatEther(balanceWei))} ${native}<br>` +
              `Enough for ${RELAYER_WARN_SWEEPS} sweeps at current gas: ~${escapeHtml(ethers.formatEther(warnBelowWei))} ${native}`,
            `When it reaches zero, token payments on ${escapeHtml(network)} confirm but wait to forward until it is topped up.`,
          ]),
        });
      }
    } catch (error) {
      console.error(`[RelayerHealth] ${network} check failed:`, error);
    }
  }

  // TRON: only once USDT on TRON is switched on, so an unconfigured instance
  // does not get a "relayer low" email for a chain it does not use.
  if (isUsdtTronEnabled()) {
    try {
      const { address } = deriveTronRelayerWallet();
      const balanceSun = await getTrxBalanceSun(address, { solidified: false });
      // ~16 TRX covers one sweep at today's energy price; warn under 10 sweeps.
      const warnBelowSun = 160n * SUN_PER_TRX;
      const low = balanceSun < warnBelowSun;
      // Reported in the wei-shaped fields scaled by 1e12 so formatEther reads TRX.
      floats.push({ network: 'TRON', address, balanceWei: balanceSun * 10n ** 12n, warnBelowWei: warnBelowSun * 10n ** 12n, low });
      if (low) {
        const trx = (Number(balanceSun) / 1e6).toString();
        await sendOpsAlert(supabase, {
          key: 'relayer-low:TRON',
          throttleMs: 12 * HOUR,
          subject: `CoinPay: TRON gas relayer is low (${trx} TRX)`,
          html: alertHtml([
            'The TRON gas relayer pays the energy for every USDT (TRC-20) payment forwarded on TRON.',
            `Relayer: <code>${escapeHtml(address)}</code><br>Balance: ${escapeHtml(trx)} TRX<br>` +
              `Enough for ${RELAYER_WARN_SWEEPS} sweeps: ~${Number(warnBelowSun) / 1e6} TRX`,
            'When it runs out, USDT payments on TRON confirm but wait to forward until it is topped up.',
          ]),
        });
      }
    } catch (error) {
      console.error('[RelayerHealth] TRON check failed:', error);
    }
  }
  // Solana: the fee payer covers the fee and the recipient's token-account
  // rent on every USDC/USDT forward and escrow settle on Solana.
  try {
    const { address } = await deriveSolanaFeePayer();
    const lamports = BigInt(await new Connection(getRpcUrl('SOL'), 'confirmed').getBalance(new PublicKey(address)));
    const warnBelowLamports = SOLANA_FEE_PAYER_WARN_LAMPORTS;
    const low = lamports < warnBelowLamports;
    // Reported in the wei-shaped fields scaled by 1e9 so formatEther reads SOL.
    floats.push({ network: 'Solana', address, balanceWei: lamports * 10n ** 9n, warnBelowWei: warnBelowLamports * 10n ** 9n, low });
    if (low) {
      const sol = (Number(lamports) / 1e9).toString();
      await sendOpsAlert(supabase, {
        key: 'relayer-low:Solana',
        throttleMs: 12 * HOUR,
        subject: `CoinPay: Solana fee payer is low (${sol} SOL)`,
        html: alertHtml([
          'The Solana fee payer pays the network fee, and the rent for a recipient\'s token account, on every USDC/USDT payment forwarded and every escrow settled on Solana.',
          `Fee payer: <code>${escapeHtml(address)}</code><br>Balance: ${escapeHtml(sol)} SOL<br>` +
            `Enough for ${RELAYER_WARN_SWEEPS} forwards that each open two token accounts: ~${Number(warnBelowLamports) / 1e9} SOL`,
          'When it runs out, those forwards fall back to the deposit address paying, which holds no SOL, so they wait until it is topped up.',
        ]),
      });
    }
  } catch (error) {
    console.error('[RelayerHealth] Solana check failed:', error);
  }
  return floats;
}

/** Ten forwards that each open two token accounts (~0.00204 SOL rent each) plus fees. */
export const SOLANA_FEE_PAYER_WARN_LAMPORTS = 10n * (2n * 2_039_280n + 10_000n);
