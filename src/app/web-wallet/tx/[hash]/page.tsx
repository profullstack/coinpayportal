'use client';

import { use } from 'react';
import { redirect } from 'next/navigation';

/**
 * /web-wallet/tx/[hash]
 *
 * No internal transaction detail page — redirect to the blockchain explorer.
 * The hash param is expected to be "chain:txHash" (e.g. "SOL:3ykv8K...").
 * If no chain prefix, we can't determine the explorer, so redirect to dashboard.
 */

const EXPLORER_URLS: Record<string, string> = {
  BTC: 'https://blockstream.info/tx/',
  BCH: 'https://blockchair.com/bitcoin-cash/transaction/',
  ETH: 'https://etherscan.io/tx/',
  POL: 'https://polygonscan.com/tx/',
  SOL: 'https://explorer.solana.com/tx/',
  USDC_ETH: 'https://etherscan.io/tx/',
  USDC_POL: 'https://polygonscan.com/tx/',
  USDC_SOL: 'https://explorer.solana.com/tx/',
};

export default function TransactionRedirectPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = use(params);

  // Expect "chain:txHash" format
  const colonIdx = hash.indexOf(':');
  if (colonIdx > 0) {
    const chain = decodeURIComponent(hash.slice(0, colonIdx));
    const txHash = decodeURIComponent(hash.slice(colonIdx + 1));
    const base = EXPLORER_URLS[chain];
    if (base && txHash) {
      redirect(base + txHash);
    }
  }

  // Fallback: no chain info, go back to dashboard
  redirect('/web-wallet');
}
