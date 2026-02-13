/**
 * Reputation SDK Module
 *
 * Query and submit reputation data for the CoinPayPortal Reputation Protocol (CPR).
 *
 * @example
 * import { CoinPayClient } from '@profullstack/coinpay';
 * import { submitReceipt, getReputation } from '@profullstack/coinpay/reputation';
 */

/**
 * Submit a task receipt
 * @param {import('./client.js').CoinPayClient} client
 * @param {Object} receipt - Receipt data
 * @returns {Promise<Object>}
 */
export async function submitReceipt(client, receipt) {
  return client.request('/reputation/receipt', {
    method: 'POST',
    body: JSON.stringify(receipt),
  });
}

/**
 * Get reputation for an agent DID
 * @param {import('./client.js').CoinPayClient} client
 * @param {string} agentDid
 * @returns {Promise<Object>}
 */
export async function getReputation(client, agentDid) {
  return client.request(`/reputation/agent/${encodeURIComponent(agentDid)}/reputation`);
}

/**
 * Get a specific credential
 * @param {import('./client.js').CoinPayClient} client
 * @param {string} credentialId
 * @returns {Promise<Object>}
 */
export async function getCredential(client, credentialId) {
  return client.request(`/reputation/credential/${credentialId}`);
}

/**
 * Verify a credential
 * @param {import('./client.js').CoinPayClient} client
 * @param {Object} credential - { credential_id: string }
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
export async function verifyCredential(client, credential) {
  return client.request('/reputation/verify', {
    method: 'POST',
    body: JSON.stringify(credential),
  });
}

/**
 * Get the revocation list
 * @param {import('./client.js').CoinPayClient} client
 * @returns {Promise<Object>}
 */
export async function getRevocationList(client) {
  return client.request('/reputation/revocation-list');
}

/**
 * Get the authenticated merchant's DID
 * @param {import('./client.js').CoinPayClient} client
 * @returns {Promise<Object>}
 */
export async function getMyDid(client) {
  return client.request('/reputation/did/me');
}

/**
 * Claim (auto-generate) a new DID for the authenticated merchant
 * @param {import('./client.js').CoinPayClient} client
 * @returns {Promise<Object>}
 */
export async function claimDid(client) {
  return client.request('/reputation/did/claim', {
    method: 'POST',
  });
}

/**
 * Link an existing DID to the authenticated merchant
 * @param {import('./client.js').CoinPayClient} client
 * @param {Object} params
 * @param {string} params.did - The DID to link
 * @param {string} params.publicKey - Base64url-encoded public key
 * @param {string} params.signature - Base64url-encoded signature
 * @returns {Promise<Object>}
 */
export async function linkDid(client, { did, publicKey, signature }) {
  return client.request('/reputation/did/claim', {
    method: 'POST',
    body: JSON.stringify({
      did,
      public_key: publicKey,
      signature,
    }),
  });
}

/**
 * Get all credentials for a DID
 * @param {import('./client.js').CoinPayClient} client
 * @param {string} did - The DID to query credentials for
 * @returns {Promise<Object>}
 */
export async function getCredentials(client, did) {
  return client.request(`/reputation/credentials?did=${encodeURIComponent(did)}`);
}

/**
 * Get all task receipts for a DID
 * @param {import('./client.js').CoinPayClient} client
 * @param {string} did - The DID to query receipts for
 * @returns {Promise<Object>}
 */
export async function getReceipts(client, did) {
  return client.request(`/reputation/receipts?did=${encodeURIComponent(did)}`);
}

// ═══════════════════════════════════════════════════════════
// CPTL Phase 2 — Action Receipts & Trust Profile
// ═══════════════════════════════════════════════════════════

const CANONICAL_CATEGORIES = [
  'economic.transaction', 'economic.dispute', 'economic.refund',
  'productivity.task', 'productivity.application', 'productivity.completion',
  'identity.profile_update', 'identity.verification',
  'social.post', 'social.comment', 'social.endorsement',
  'compliance.incident', 'compliance.violation',
];

/**
 * Submit an action receipt with schema validation
 * @param {import('./client.js').CoinPayClient} client
 * @param {Object} receipt - Action receipt with action_category
 * @returns {Promise<Object>}
 */
export async function submitActionReceipt(client, receipt) {
  // Validate action_category if provided
  if (receipt.action_category && !CANONICAL_CATEGORIES.includes(receipt.action_category)) {
    throw new Error(`Invalid action_category: ${receipt.action_category}. Must be one of: ${CANONICAL_CATEGORIES.join(', ')}`);
  }
  // Default action_category
  if (!receipt.action_category) {
    receipt = { ...receipt, action_category: 'economic.transaction' };
  }
  return client.request('/reputation/receipt', {
    method: 'POST',
    body: JSON.stringify(receipt),
  });
}

/**
 * Get trust profile (trust vector) for an agent DID
 * @param {import('./client.js').CoinPayClient} client
 * @param {string} agentDid
 * @returns {Promise<Object>} Trust vector { E, P, B, D, R, A, C }
 */
export async function getTrustProfile(client, agentDid) {
  const result = await client.request(`/reputation/agent/${encodeURIComponent(agentDid)}/reputation`);
  return {
    trust_vector: result.trust_vector || null,
    reputation: result.reputation || null,
    computed_at: result.computed_at || null,
  };
}

/**
 * Get the badge URL for a DID
 * @param {string} baseUrl - The CoinPayPortal base URL
 * @param {string} did - The DID
 * @returns {string} Badge SVG URL
 */
export function getBadgeUrl(baseUrl, did) {
  return `${baseUrl}/api/reputation/badge/${encodeURIComponent(did)}`;
}
