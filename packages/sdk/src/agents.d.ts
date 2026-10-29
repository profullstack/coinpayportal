import type { CoinPayClient } from './client.js';
import type { AgentWalletLimits } from './client.js';

export interface AgentWalletInput extends AgentWalletLimits {
  name: string;
  address: string;
  status?: 'active' | 'paused' | 'revoked';
}

export declare class AgentWalletClient {
  constructor(client: CoinPayClient);
  list(): Promise<Record<string, unknown>>;
  create(input: AgentWalletInput): Promise<Record<string, unknown>>;
  update(id: string, patch: Partial<AgentWalletInput>): Promise<Record<string, unknown>>;
  pause(id: string): Promise<Record<string, unknown>>;
  resume(id: string): Promise<Record<string, unknown>>;
  revoke(id: string): Promise<Record<string, unknown>>;
}
