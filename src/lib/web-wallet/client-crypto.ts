/**
 * Client-Side Cryptography Utilities
 *
 * AES-256-GCM encryption for seed phrases using the Web Crypto API.
 * Used to encrypt the mnemonic before storing in localStorage.
 * All operations run in the browser — no server involvement.
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 600_000;

export interface EncryptedData {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded salt */
  salt: string;
  /** Base64-encoded IV */
  iv: string;
}

/**
 * Derive an AES-256 key from a password using PBKDF2.
 */
async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a string (e.g. mnemonic) with a password using AES-256-GCM.
 */
export async function encryptWithPassword(
  plaintext: string,
  password: string
): Promise<EncryptedData> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoder.encode(plaintext)
  );

  return {
    ciphertext: bufferToBase64(new Uint8Array(ciphertext)),
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
  };
}

/**
 * Decrypt an AES-256-GCM ciphertext with the password.
 * Returns null if the password is incorrect.
 */
export async function decryptWithPassword(
  encrypted: EncryptedData,
  password: string
): Promise<string | null> {
  try {
    const salt = base64ToBuffer(encrypted.salt);
    const iv = base64ToBuffer(encrypted.iv);
    const ciphertext = base64ToBuffer(encrypted.ciphertext);
    const key = await deriveKey(password, salt);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/**
 * Check password strength. Returns a score 0-4 and feedback.
 */
export function checkPasswordStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  score = Math.min(score, 4);

  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-yellow-500',
    'bg-green-500',
    'bg-emerald-500',
  ];

  return { score, label: labels[score], color: colors[score] };
}

/**
 * Clear sensitive data from memory by overwriting the string.
 * Note: JavaScript strings are immutable, so this is best-effort.
 */
export function clearSensitiveString(value: string): void {
  // Best-effort: we can't truly clear JS strings,
  // but we can help GC by removing references.
  // The caller should set their variable to null/empty after calling this.
  void value;
}

// ── Base64 Helpers ──

function bufferToBase64(buffer: Uint8Array): string {
  const binary = Array.from(buffer)
    .map((b) => String.fromCharCode(b))
    .join('');
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── localStorage Helpers ──

const STORAGE_KEY = 'coinpay_wallet';

export interface StoredWallet {
  walletId: string;
  encrypted: EncryptedData;
  createdAt: string;
  chains: string[];
}

export function saveWalletToStorage(wallet: StoredWallet): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
}

export function loadWalletFromStorage(): StoredWallet | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse stored wallet data:', err);
    return null;
  }
}

export function removeWalletFromStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasStoredWallet(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
