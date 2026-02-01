/**
 * Wallet SDK HTTP Client
 *
 * Low-level HTTP client that wraps fetch() with per-request signature
 * authentication, JWT caching, error handling, and rate limit retry.
 *
 * NO Supabase imports — all DB operations go through API routes.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import type { ApiResponse, WalletSDKConfig } from './types';
import {
  WalletSDKError,
  NetworkError,
  RateLimitError,
  AuthenticationError,
  mapApiError,
} from './errors';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: unknown;
  authenticated?: boolean;
  query?: Record<string, string | undefined>;
}

export class WalletAPIClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  private walletId: string | null = null;
  private privateKeyHex: string | null = null;

  private jwtToken: string | null = null;
  private jwtExpiresAt: number = 0;

  private readonly maxRateLimitRetries = 2;

  constructor(config: WalletSDKConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchFn = config.fetch || globalThis.fetch.bind(globalThis);
  }

  // ── Auth Configuration ──

  setSignatureAuth(walletId: string, privateKeyHex: string): void {
    this.walletId = walletId;
    this.privateKeyHex = privateKeyHex;
  }

  setJWTToken(token: string, expiresAt: string): void {
    this.jwtToken = token;
    this.jwtExpiresAt = new Date(expiresAt).getTime();
  }

  clearAuth(): void {
    this.walletId = null;
    this.privateKeyHex = null;
    this.jwtToken = null;
    this.jwtExpiresAt = 0;
  }

  getWalletId(): string | null {
    return this.walletId;
  }

  /**
   * Obtain a JWT token via challenge-response flow.
   * Requires signature auth to be configured.
   */
  async ensureJWT(): Promise<string> {
    if (this.jwtToken && this.jwtExpiresAt > Date.now() + 60_000) {
      return this.jwtToken;
    }

    if (!this.walletId || !this.privateKeyHex) {
      throw new AuthenticationError('No credentials configured for JWT refresh');
    }

    const challengeResp = await this.request<{
      challenge: string;
      challenge_id: string;
      expires_at: string;
    }>({
      method: 'GET',
      path: '/api/web-wallet/auth/challenge',
      query: { wallet_id: this.walletId },
      authenticated: false,
    });

    const messageBytes = new TextEncoder().encode(challengeResp.challenge);
    const privateKeyBytes = hexToUint8Array(this.privateKeyHex);
    const signatureBytes = secp256k1.sign(messageBytes, privateKeyBytes);
    const signatureHex = uint8ArrayToHex(signatureBytes);

    const verifyResp = await this.request<{
      auth_token: string;
      expires_at: string;
      wallet_id: string;
    }>({
      method: 'POST',
      path: '/api/web-wallet/auth/verify',
      body: {
        wallet_id: this.walletId,
        challenge_id: challengeResp.challenge_id,
        signature: signatureHex,
      },
      authenticated: false,
    });

    this.jwtToken = verifyResp.auth_token;
    this.jwtExpiresAt = new Date(verifyResp.expires_at).getTime();

    return this.jwtToken;
  }

  // ── Core Request Method ──

  async request<T>(options: RequestOptions): Promise<T> {
    const { method, path, body, authenticated = false, query } = options;

    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, value);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const bodyStr = body ? JSON.stringify(body) : '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authenticated) {
      headers['Authorization'] = this.buildAuthHeader(method, path, bodyStr);
    }

    return this.executeWithRetry<T>(url, method, headers, bodyStr);
  }

  // ── Auth Header Construction ──

  private buildAuthHeader(
    method: string,
    path: string,
    bodyStr: string
  ): string {
    if (this.jwtToken && this.jwtExpiresAt > Date.now() + 60_000) {
      return `Bearer ${this.jwtToken}`;
    }

    if (!this.walletId || !this.privateKeyHex) {
      throw new AuthenticationError('No authentication credentials configured');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const message = `${method}:${path}:${timestamp}:${bodyStr}`;
    const messageBytes = new TextEncoder().encode(message);
    const privateKeyBytes = hexToUint8Array(this.privateKeyHex);
    const signatureBytes = secp256k1.sign(messageBytes, privateKeyBytes);
    const signatureHex = uint8ArrayToHex(signatureBytes);

    return `Wallet ${this.walletId}:${signatureHex}:${timestamp}`;
  }

  // ── Fetch with Rate Limit Retry ──

  private async executeWithRetry<T>(
    url: string,
    method: string,
    headers: Record<string, string>,
    bodyStr: string,
    attempt = 0
  ): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: method !== 'GET' ? bodyStr || undefined : undefined,
      });
    } catch (err) {
      throw new NetworkError(
        `Network request to ${url} failed`,
        err instanceof Error ? err : undefined
      );
    }

    let json: ApiResponse<T>;
    try {
      json = await response.json();
    } catch {
      throw new NetworkError(`Failed to parse response from ${url}`);
    }

    if (response.status === 429 && attempt < this.maxRateLimitRetries) {
      const retryAfter = (json.error?.details?.retry_after as number) || 5;
      await sleep(retryAfter * 1000);
      return this.executeWithRetry<T>(
        url,
        method,
        headers,
        bodyStr,
        attempt + 1
      );
    }

    if (!json.success || json.error) {
      throw mapApiError(
        response.status,
        json.error || { code: 'UNKNOWN', message: 'Unknown error' }
      );
    }

    return json.data as T;
  }
}

// ── Utilities ──

export function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
