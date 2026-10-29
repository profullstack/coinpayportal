/** RFC 8628 helpers: user codes and the verification URI. */
import { randomInt } from 'crypto';

export const DEVICE_CODE_TTL_SECONDS = 600;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

// No 0/O/1/I/L. 32^8 = 2^40 codes, ~10 live at a time per IP.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeUserCode(): string {
  // randomInt is uniform (rejection sampling); `byte % 31` would favour some letters.
  let s = '';
  for (let i = 0; i < 8; i++) s += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Normalise what a person typed: case, spaces, a missing or extra dash. */
export function normalizeUserCode(input: string): string {
  const raw = (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 8) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function verificationUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
  return `${base.replace(/\/$/, '')}/oauth/device`;
}
