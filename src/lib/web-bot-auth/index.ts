/**
 * Web Bot Auth — cryptographic identity for automated traffic.
 *
 * Verifies RFC 9421 HTTP Message Signatures tagged `web-bot-auth`, so an
 * origin can tell which agent is calling it instead of guessing from a
 * User-Agent string that anyone can type.
 */

export {
  verifyWebBotAuth,
  WEB_BOT_AUTH_TAG,
  MAX_SIGNATURE_LIFETIME_SECONDS,
  CLOCK_SKEW_SECONDS,
} from './verify';
export type {
  VerificationResult,
  VerifiedAgent,
  UnverifiedAgent,
  VerifyFailureReason,
} from './verify';

export {
  buildSignatureBase,
  UnresolvableComponentError,
} from './signature-base';
export type { SignableRequest } from './signature-base';

export {
  parseSignatureInput,
  parseSignatureHeader,
} from './structured-fields';
export type { SignatureInputEntry } from './structured-fields';

export {
  jwkThumbprint,
  isEd25519Jwk,
  toPublicKey,
  fetchDirectory,
  findKeyByThumbprint,
  directoryUrlFor,
  clearDirectoryCache,
  DIRECTORY_PATH,
  DIRECTORY_CONTENT_TYPE,
} from './directory';
export type { Ed25519Jwk } from './directory';
