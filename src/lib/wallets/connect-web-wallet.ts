/**
 * Browser-side flow for associating a locally-held web wallet with the signed-in
 * CoinPay account.
 *
 * The web wallet is non-custodial: its seed lives encrypted in this browser and
 * the server only ever knows public keys. So "connecting" it cannot be a simple
 * `wallet_id` claim — anyone could name someone else's wallet id and start
 * receiving their invoice payouts. Instead the holder proves control the same
 * way the wallet authenticates itself everywhere else: unlock locally, sign a
 * server-issued challenge, send the signature.
 *
 * The password and mnemonic never leave this function.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { decryptWithPassword } from '@/lib/web-wallet/client-crypto';
import { deriveWalletBundle } from '@/lib/web-wallet/keys';
import { getWalletRegistry, type WalletEntry } from '@/lib/web-wallet/wallet-registry';

export interface LocalWallet {
  id: string;
  label: string;
  createdAt: string;
  chains: string[];
}

export interface ConnectResult {
  ok: boolean;
  error?: string;
  link?: Record<string, unknown>;
}

/** Web wallets held in this browser, offered as connect candidates. */
export function listLocalWallets(): LocalWallet[] {
  if (typeof window === 'undefined') return [];
  try {
    return Object.values(getWalletRegistry()).map((entry: WalletEntry) => ({
      id: entry.id,
      label: entry.label,
      createdAt: entry.createdAt,
      chains: entry.chains ?? [],
    }));
  } catch {
    return [];
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Unlock a local wallet, prove ownership to the server, and record the link.
 *
 * `authorizedFetch` is injected so this stays free of any particular auth
 * client — the caller passes whatever already carries the merchant session.
 */
export async function connectWebWallet(input: {
  walletId: string;
  password: string;
  businessId?: string | null;
  label?: string | null;
  isDefault?: boolean;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<ConnectResult> {
  const entry = getWalletRegistry()[input.walletId];
  if (!entry) {
    return { ok: false, error: 'That wallet is not stored in this browser.' };
  }

  let mnemonic: string;
  try {
    // A wrong password surfaces either as a throw or as a null decrypt,
    // depending on where the AES-GCM check fails — treat both the same.
    const decrypted = await decryptWithPassword(entry.encrypted, input.password);
    if (!decrypted) {
      return { ok: false, error: 'Incorrect password for this wallet.' };
    }
    mnemonic = decrypted;
  } catch {
    return { ok: false, error: 'Incorrect password for this wallet.' };
  }

  let privateKeyHex: string;
  try {
    // Only one chain is derived — we need the master secp256k1 key for the
    // signature, not the full address set, and derivation is expensive.
    const bundle = await deriveWalletBundle(mnemonic, ['ETH']);
    if (!bundle.privateKeySecp256k1) {
      return { ok: false, error: 'This wallet cannot produce an ownership proof.' };
    }
    privateKeyHex = bundle.privateKeySecp256k1;
  } catch {
    return { ok: false, error: 'Failed to unlock this wallet.' };
  }

  // 1. Ask the server for a challenge bound to this wallet.
  const challengeResponse = await fetch(
    `/api/web-wallet/auth/challenge?wallet_id=${encodeURIComponent(input.walletId)}`,
  );
  const challengeBody = await challengeResponse.json().catch(() => null);
  const challenge = challengeBody?.data?.challenge;
  const challengeId = challengeBody?.data?.challenge_id;

  if (!challengeResponse.ok || !challenge || !challengeId) {
    return {
      ok: false,
      error: challengeBody?.error?.message || 'Could not start wallet verification.',
    };
  }

  // 2. Sign it locally.
  const signature = toHex(
    secp256k1.sign(new TextEncoder().encode(challenge), fromHex(privateKeyHex)),
  );

  // 3. Hand the proof to the account-scoped endpoint.
  const response = await input.authorizedFetch('/api/wallets/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet_id: input.walletId,
      challenge_id: challengeId,
      signature,
      business_id: input.businessId || undefined,
      label: input.label || entry.label,
      is_default: !!input.isDefault,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    return { ok: false, error: body?.error || 'Failed to connect this wallet.' };
  }

  return { ok: true, link: body.link };
}
