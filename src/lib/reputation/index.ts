export { submitReceipt, receiptSchema } from './receipt-service';
export { computeReputation, issueCredential } from './attestation-engine';
export { analyzeAgent, detectCircularPayments, detectBurst, calculateBuyerDiversity } from './anti-gaming';
export { sign, verifySignature, signCredential, verifyCredentialSignature, isValidDid, validateReceiptSignatures } from './crypto';
export { computeTrustVector, economicScale, diminishingReturns, recencyDecay, isValidActionCategory, CANONICAL_CATEGORIES, BASE_WEIGHTS } from './trust-engine';
export type { TrustVector, TrustProfile, ActionCategory } from './trust-engine';
