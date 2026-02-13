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
