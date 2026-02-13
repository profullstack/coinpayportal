import { CoinPayClient } from './client';

export interface TaskReceipt {
  receipt_id: string;
  task_id: string;
  agent_did: string;
  buyer_did: string;
  platform_did: string;
  escrow_tx?: string;
  amount: number;
  currency: string;
  category?: string;
  sla?: Record<string, unknown>;
  outcome: 'completed' | 'failed' | 'disputed' | 'cancelled';
  dispute?: boolean;
  artifact_hash?: string;
  signatures: {
    agent?: string;
    buyer?: string;
    platform?: string;
  };
  finalized_at?: string;
}

export interface ReputationSummary {
  agent_did: string;
  total_tasks: number;
  completed: number;
  failed: number;
  disputed: number;
  cancelled: number;
  completion_rate: number;
  dispute_rate: number;
  total_volume: number;
  avg_task_value: number;
  unique_buyers: number;
  categories: Record<string, { count: number; volume: number }>;
  anti_gaming: {
    circular_payment: boolean;
    burst_detected: boolean;
    below_economic_threshold: boolean;
    insufficient_unique_buyers: boolean;
    flagged: boolean;
    details: string[];
  };
}

export interface MultiWindowReputation {
  '30d': ReputationSummary;
  '90d': ReputationSummary;
  all: ReputationSummary;
}

export interface CredentialVerification {
  valid: boolean;
  reason: string;
  credential?: Record<string, unknown>;
}

export interface RevocationList {
  revoked: string[];
  details: Array<{ credential_id: string; reason: string; revoked_at: string }>;
}

export function submitReceipt(client: CoinPayClient, receipt: TaskReceipt): Promise<{ id: string; verified_signatures: string[] }>;
export function getReputation(client: CoinPayClient, agentDid: string): Promise<MultiWindowReputation>;
export function getCredential(client: CoinPayClient, credentialId: string): Promise<Record<string, unknown>>;
export function verifyCredential(client: CoinPayClient, credentialId: string): Promise<CredentialVerification>;
export function getRevocationList(client: CoinPayClient): Promise<RevocationList>;
