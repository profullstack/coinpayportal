/**
 * Web Wallet Authentication Service
 *
 * Provides signature-based authentication for anonymous wallets.
 * Two auth methods:
 * 1. Per-request signature: Authorization: Wallet <wallet_id>:<signature>:<timestamp>
 * 2. Challenge-response JWT: Authorization: Bearer <jwt_token>
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateToken, verifyToken } from '../auth/jwt';
import { checkAndRecordSignature } from './rate-limit';

/** Auth result for wallet requests */
export interface WalletAuthResult {
  success: boolean;
  walletId?: string;
  error?: string;
}

/** Wallet record from DB */
export interface WalletRecord {
  id: string;
  public_key_secp256k1: string | null;
  public_key_ed25519: string | null;
  status: string;
  created_at: string;
  last_active_at: string;
}

/** Signature timestamp window (5 minutes) */
const TIMESTAMP_WINDOW_SECONDS = 300;

/**
 * Authenticate a web-wallet request.
 * Supports both per-request signature and JWT token auth.
 */
export async function authenticateWalletRequest(
  supabase: SupabaseClient,
  authHeader: string | null,
  method?: string,
  path?: string,
  body?: string
): Promise<WalletAuthResult> {
  if (!authHeader) {
    return { success: false, error: 'Missing authorization header' };
  }

  // Per-request signature: "Wallet <wallet_id>:<signature>:<timestamp>"
  if (authHeader.startsWith('Wallet ')) {
    const result = await authenticateWithSignature(supabase, authHeader, method, path, body);
    if (!result.success) {
      console.error(`[Auth] Signature auth failed: ${result.error}`);
    }
    return result;
  }

  // JWT bearer token: "Bearer <token>"
  if (authHeader.startsWith('Bearer ')) {
    const result = await authenticateWithWalletJWT(supabase, authHeader);
    if (!result.success) {
      console.error(`[Auth] JWT auth failed: ${result.error}`);
    }
    return result;
  }

  return { success: false, error: 'Invalid authorization format' };
}

/**
 * Verify per-request signature authentication.
 */
async function authenticateWithSignature(
  supabase: SupabaseClient,
  authHeader: string,
  method?: string,
  path?: string,
  body?: string
): Promise<WalletAuthResult> {
  try {
    const credentials = authHeader.slice(7); // Remove "Wallet "
    const parts = credentials.split(':');

    if (parts.length !== 3 && parts.length !== 4) {
      return { success: false, error: 'Invalid wallet auth format' };
    }

    const walletId = parts[0];
    const signatureHex = parts[1];
    const timestampStr = parts[2];
    const nonce = parts[3] || ''; // Optional nonce for replay prevention

    // Validate timestamp window
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      return { success: false, error: 'Invalid timestamp' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > TIMESTAMP_WINDOW_SECONDS) {
      return { success: false, error: 'Request timestamp expired' };
    }

    // Replay prevention: check if this exact signature was already used
    const sigKey = `${walletId}:${signatureHex}:${timestampStr}:${nonce}`;
    if (!checkAndRecordSignature(sigKey)) {
      return { success: false, error: 'Replay detected: signature already used' };
    }

    // Get wallet from database
    const wallet = await getWalletById(supabase, walletId);
    if (!wallet) {
      return { success: false, error: 'Wallet not found' };
    }

    if (wallet.status !== 'active') {
      return { success: false, error: 'Wallet is not active' };
    }

    if (!wallet.public_key_secp256k1) {
      return { success: false, error: 'Wallet has no secp256k1 public key' };
    }

    // Reconstruct the signed message (raw bytes, prehash handled by noble-curves)
    const message = nonce
      ? `${method || 'GET'}:${path || '/'}:${timestamp}:${nonce}:${body || ''}`
      : `${method || 'GET'}:${path || '/'}:${timestamp}:${body || ''}`;
    const messageBytes = new TextEncoder().encode(message);

    // Verify secp256k1 signature (prehash: true is the default - noble-curves hashes internally)
    const isValid = verifySecp256k1Signature(
      signatureHex,
      messageBytes,
      wallet.public_key_secp256k1
    );

    if (!isValid) {
      return { success: false, error: 'Invalid signature' };
    }

    return { success: true, walletId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Signature verification failed',
    };
  }
}

/**
 * Verify JWT token authentication for wallet.
 */
async function authenticateWithWalletJWT(
  supabase: SupabaseClient,
  authHeader: string
): Promise<WalletAuthResult> {
  try {
    const token = authHeader.slice(7); // Remove "Bearer "
    if (!token) {
      return { success: false, error: 'Missing token' };
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return { success: false, error: 'Server configuration error' };
    }

    const decoded = verifyToken(token, jwtSecret);
    if (!decoded || decoded.type !== 'wallet' || !decoded.sub) {
      return { success: false, error: 'Invalid wallet token' };
    }

    // Verify wallet still exists and is active
    const wallet = await getWalletById(supabase, decoded.sub);
    if (!wallet) {
      return { success: false, error: 'Wallet not found' };
    }

    if (wallet.status !== 'active') {
      return { success: false, error: 'Wallet is not active' };
    }

    return { success: true, walletId: decoded.sub };
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) {
      return { success: false, error: 'Token has expired' };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Token verification failed',
    };
  }
}

/**
 * Generate a challenge string for auth challenge-response flow.
 */
export function generateChallenge(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = randomBytes(16).toString('hex');
  console.log(`[Auth] Generated challenge at timestamp=${timestamp}`);
  return `coinpayportal:auth:${timestamp}:${random}`;
}

/**
 * Verify a secp256k1 signature against a challenge message.
 * Used for challenge-response auth flow.
 */
export function verifyChallengeSignature(
  challenge: string,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(challenge);
    return verifySecp256k1Signature(signatureHex, messageBytes, publicKeyHex);
  } catch {
    return false;
  }
}

/**
 * Generate a wallet JWT token (1 hour expiry).
 */
export function generateWalletToken(walletId: string): string {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('[Auth] JWT_SECRET not configured');
    throw new Error('JWT_SECRET not configured');
  }

  console.log(`[Auth] Generating JWT for wallet ${walletId}`);

  return generateToken(
    {
      sub: walletId,
      type: 'wallet',
      iss: 'coinpayportal.com',
      aud: 'wallet-api',
    },
    jwtSecret,
    '1h'
  );
}

/**
 * Verify a secp256k1 compact signature.
 * noble-curves v2 verify() requires all params as Uint8Array.
 */
function verifySecp256k1Signature(
  signatureHex: string,
  messageBytes: Uint8Array,
  publicKeyHex: string
): boolean {
  try {
    if (!signatureHex || !publicKeyHex) return false;

    const cleanPubKey = publicKeyHex.startsWith('0x')
      ? publicKeyHex.slice(2)
      : publicKeyHex;

    // Convert hex strings to Uint8Array - noble-curves v2 requires bytes for all params
    const sigBytes = Uint8Array.from(Buffer.from(signatureHex, 'hex'));
    const pubKeyBytes = Uint8Array.from(Buffer.from(cleanPubKey, 'hex'));

    return secp256k1.verify(sigBytes, messageBytes, pubKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Fetch a wallet record by ID.
 */
export async function getWalletById(
  supabase: SupabaseClient,
  walletId: string
): Promise<WalletRecord | null> {
  const { data, error } = await supabase
    .from('wallets')
    .select('id, public_key_secp256k1, public_key_ed25519, status, created_at, last_active_at')
    .eq('id', walletId)
    .single();

  if (error || !data) return null;
  return data as WalletRecord;
}

/**
 * Find a wallet by its secp256k1 public key.
 */
export async function findWalletByPublicKey(
  supabase: SupabaseClient,
  publicKeySecp256k1: string
): Promise<WalletRecord | null> {
  const { data, error } = await supabase
    .from('wallets')
    .select('id, public_key_secp256k1, public_key_ed25519, status, created_at, last_active_at')
    .eq('public_key_secp256k1', publicKeySecp256k1)
    .single();

  if (error || !data) return null;
  return data as WalletRecord;
}

/**
 * Hash a message using SHA-256 (utility for clients to construct signatures).
 */
export function hashMessage(message: string): string {
  return createHash('sha256').update(message).digest('hex');
}
