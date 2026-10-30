/** Mercury-style capped agent wallets. */
export class AgentWalletClient {
  #client;
  constructor(client) { this.#client = client; }
  list() { return this.#client.request('/v1/agents'); }
  create(input) { return this.#client.request('/v1/agents', { method: 'POST', body: JSON.stringify(input) }); }
  update(id, patch) { return this.#client.request(`/v1/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
  pause(id) { return this.update(id, { status: 'paused' }); }
  resume(id) { return this.update(id, { status: 'active' }); }
  revoke(id) { return this.#client.request(`/v1/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
}
