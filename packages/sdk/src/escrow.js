/**
 * Escrow SDK Module
 *
 * Anonymous, non-custodial escrow for crypto payments.
 * Both humans and AI agents can create/fund/release/dispute escrows.
 *
 * @example
 * import { CoinPayClient } from '@profullstack/coinpay';
 *
 * const client = new CoinPayClient({ apiKey: 'your-key' });
 *
 * // Create escrow
 * const escrow = await client.createEscrow({
 *   chain: 'SOL',
 *   amount: 0.5,
 *   depositorAddress: 'depositor-wallet',
 *   beneficiaryAddress: 'worker-wallet',
 *   metadata: { job: 'Code review', deadline: '2026-02-10' }
 * });
 * // Save escrow.releaseToken — needed to release/refund
 *
 * // Check status
 * const status = await client.getEscrow(escrow.id);
 *
 * // Release funds to worker
 * await client.releaseEscrow(escrow.id, escrow.releaseToken);
 */

/**
 * Create a new escrow
 * @param {CoinPayClient} client - API client instance
 * @param {Object} params - Escrow parameters
 * @param {string} params.chain - Blockchain (BTC, ETH, SOL, POL, etc.)
 * @param {number} params.amount - Crypto amount to escrow
 * @param {string} params.depositorAddress - Wallet address for refunds
 * @param {string} params.beneficiaryAddress - Wallet address for releases
 * @param {string} [params.arbiterAddress] - Optional dispute resolver address
 * @param {Object} [params.metadata] - Job details, milestones, etc.
 * @param {number} [params.expiresInHours] - Deposit window (default: 24h)
 * @returns {Promise<Object>} Created escrow with releaseToken and beneficiaryToken
 */
export async function createEscrow(client, {
  chain,
  amount,
  depositorAddress,
  beneficiaryAddress,
  arbiterAddress,
  metadata,
  expiresInHours,
}) {
  const body = {
    chain,
    amount,
    depositor_address: depositorAddress,
    beneficiary_address: beneficiaryAddress,
  };
  if (arbiterAddress) body.arbiter_address = arbiterAddress;
  if (metadata) body.metadata = metadata;
  if (expiresInHours) body.expires_in_hours = expiresInHours;

  const data = await client.request('/escrow', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    id: data.id,
    escrowAddress: data.escrow_address,
    chain: data.chain,
    amount: data.amount,
    amountUsd: data.amount_usd,
    status: data.status,
    depositorAddress: data.depositor_address,
    beneficiaryAddress: data.beneficiary_address,
    releaseToken: data.release_token,
    beneficiaryToken: data.beneficiary_token,
    metadata: data.metadata,
    expiresAt: data.expires_at,
    createdAt: data.created_at,
  };
}

/**
 * Get escrow status
 * @param {CoinPayClient} client
 * @param {string} escrowId
 * @returns {Promise<Object>} Escrow status (public view, no tokens)
 */
export async function getEscrow(client, escrowId) {
  const data = await client.request(`/escrow/${escrowId}`);
  return normalizeEscrow(data);
}

/**
 * List escrows with filters
 * @param {CoinPayClient} client
 * @param {Object} [filters]
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.depositor] - Filter by depositor address
 * @param {string} [filters.beneficiary] - Filter by beneficiary address
 * @param {number} [filters.limit] - Results per page (default: 20)
 * @param {number} [filters.offset] - Offset for pagination
 * @returns {Promise<Object>} { escrows, total, limit, offset }
 */
export async function listEscrows(client, filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.depositor) params.set('depositor', filters.depositor);
  if (filters.beneficiary) params.set('beneficiary', filters.beneficiary);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));

  const data = await client.request(`/escrow?${params.toString()}`);
  return {
    escrows: (data.escrows || []).map(normalizeEscrow),
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

/**
 * Release escrow funds to beneficiary
 * @param {CoinPayClient} client
 * @param {string} escrowId
 * @param {string} releaseToken - Secret token from escrow creation
 * @returns {Promise<Object>} Updated escrow
 */
export async function releaseEscrow(client, escrowId, releaseToken) {
  const data = await client.request(`/escrow/${escrowId}/release`, {
    method: 'POST',
    body: JSON.stringify({ release_token: releaseToken }),
  });
  return normalizeEscrow(data);
}

/**
 * Refund escrow to depositor
 * @param {CoinPayClient} client
 * @param {string} escrowId
 * @param {string} releaseToken
 * @returns {Promise<Object>} Updated escrow
 */
export async function refundEscrow(client, escrowId, releaseToken) {
  const data = await client.request(`/escrow/${escrowId}/refund`, {
    method: 'POST',
    body: JSON.stringify({ release_token: releaseToken }),
  });
  return normalizeEscrow(data);
}

/**
 * Dispute an escrow
 * @param {CoinPayClient} client
 * @param {string} escrowId
 * @param {string} token - release_token or beneficiary_token
 * @param {string} reason - Dispute reason (min 10 chars)
 * @returns {Promise<Object>} Updated escrow
 */
export async function disputeEscrow(client, escrowId, token, reason) {
  const data = await client.request(`/escrow/${escrowId}/dispute`, {
    method: 'POST',
    body: JSON.stringify({ token, reason }),
  });
  return normalizeEscrow(data);
}

/**
 * Get escrow event log
 * @param {CoinPayClient} client
 * @param {string} escrowId
 * @returns {Promise<Array>} Array of events
 */
export async function getEscrowEvents(client, escrowId) {
  const data = await client.request(`/escrow/${escrowId}/events`);
  return (data.events || []).map(e => ({
    id: e.id,
    escrowId: e.escrow_id,
    eventType: e.event_type,
    actor: e.actor,
    details: e.details,
    createdAt: e.created_at,
  }));
}

/**
 * Poll escrow until it reaches a target status
 * @param {CoinPayClient} client
 * @param {string} escrowId
 * @param {Object} [options]
 * @param {string} [options.targetStatus] - Status to wait for (default: 'funded')
 * @param {number} [options.intervalMs] - Poll interval (default: 10000)
 * @param {number} [options.timeoutMs] - Max wait time (default: 3600000 = 1h)
 * @returns {Promise<Object>} Escrow when target status reached
 */
export async function waitForEscrow(client, escrowId, options = {}) {
  const {
    targetStatus = 'funded',
    intervalMs = 10000,
    timeoutMs = 3600000,
  } = options;

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const escrow = await getEscrow(client, escrowId);

    if (escrow.status === targetStatus) return escrow;
    if (['settled', 'refunded', 'expired'].includes(escrow.status)) return escrow;

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Escrow ${escrowId} did not reach status '${targetStatus}' within ${timeoutMs}ms`);
}

// ── Helpers ──

function normalizeEscrow(data) {
  return {
    id: data.id,
    escrowAddress: data.escrow_address,
    chain: data.chain,
    amount: data.amount,
    amountUsd: data.amount_usd,
    feeAmount: data.fee_amount,
    depositedAmount: data.deposited_amount,
    status: data.status,
    depositorAddress: data.depositor_address,
    beneficiaryAddress: data.beneficiary_address,
    arbiterAddress: data.arbiter_address,
    depositTxHash: data.deposit_tx_hash,
    settlementTxHash: data.settlement_tx_hash,
    metadata: data.metadata,
    disputeReason: data.dispute_reason,
    disputeResolution: data.dispute_resolution,
    createdAt: data.created_at,
    fundedAt: data.funded_at,
    releasedAt: data.released_at,
    settledAt: data.settled_at,
    disputedAt: data.disputed_at,
    refundedAt: data.refunded_at,
    expiresAt: data.expires_at,
  };
}
