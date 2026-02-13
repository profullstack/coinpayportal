/**
 * Reputation SDK Module
 *
 * Submit receipts, query reputation, verify credentials.
 *
 * @example
 * import { CoinPayClient } from '@profullstack/coinpay';
 * const client = new CoinPayClient({ apiKey: 'your-key' });
 *
 * // Submit a task receipt
 * const result = await client.submitReceipt({ ... });
 *
 * // Get agent reputation
 * const rep = await client.getReputation('did:web:agent.example.com');
 */

/**
 * Submit a task receipt
 */
export async function submitReceipt(client, receipt) {
  return client._request('POST', '/api/reputation/receipt', receipt);
}

/**
 * Get aggregated reputation for an agent DID
 */
export async function getReputation(client, agentDid) {
  const encoded = encodeURIComponent(agentDid);
  return client._request('GET', `/api/reputation/agent/${encoded}/reputation`);
}

/**
 * Get a specific credential by ID
 */
export async function getCredential(client, credentialId) {
  return client._request('GET', `/api/reputation/credential/${credentialId}`);
}

/**
 * Verify a credential
 */
export async function verifyCredential(client, credentialId) {
  return client._request('POST', '/api/reputation/verify', { credential_id: credentialId });
}

/**
 * Get the revocation list
 */
export async function getRevocationList(client) {
  return client._request('GET', '/api/reputation/revocation-list');
}
