import { CoinPayClient } from './client';

export interface ReceiptInput {
  receipt_id: string;
  task_id: string;
  agent_did: string;
  buyer_did: string;
  platform_did?: string;
  escrow_tx?: string;
  amount?: number;
  currency?: string;
  category?: string;
  sla?: Record<string, unknown>;
  outcome: 'accepted' | 'rejected' | 'disputed';
  dispute?: boolean;
  artifact_hash?: string;
  signatures: {
    escrow_sig: string;
    agent_sig?: string;
    buyer_sig?: string;
    arbitration_sig?: string;
  };
  finalized_at?: string;
}

export interface ReputationWindow {
  task_count: number;
  accepted_count: number;
  disputed_count: number;
  total_volume: number;
  unique_buyers: number;
  avg_task_value: number;
  accepted_rate: number;
  dispute_rate: number;
  categories: Record<string, { count: number; volume: number }>;
}

export interface ReputationResult {
  agent_did: string;
  windows: {
    last_30_days: ReputationWindow;
    last_90_days: ReputationWindow;
    all_time: ReputationWindow;
  };
  anti_gaming: {
    flagged: boolean;
    flags: string[];
    adjusted_weight: number;
  };
}

export interface Credential {
  id: string;
  agent_did: string;
  credential_type: string;
  category?: string;
  data: Record<string, unknown>;
  window_start: string;
  window_end: string;
  issued_at: string;
  issuer_did: string;
  signature: string;
  revoked: boolean;
  revoked_at?: string;
}

export function submitReceipt(client: CoinPayClient, receipt: ReceiptInput): Promise<{ success: boolean; receipt?: Record<string, unknown>; error?: string }>;
export function getReputation(client: CoinPayClient, agentDid: string): Promise<{ success: boolean; reputation: ReputationResult }>;
export function getCredential(client: CoinPayClient, credentialId: string): Promise<{ success: boolean; credential: Credential }>;
export function verifyCredential(client: CoinPayClient, credential: { credential_id: string }): Promise<{ valid: boolean; reason?: string }>;
export function getRevocationList(client: CoinPayClient): Promise<{ success: boolean; revoked_credentials: string[]; revocations: Array<Record<string, unknown>> }>;

// CPTL Phase 2

export type ActionCategory =
  | 'economic.transaction' | 'economic.dispute' | 'economic.refund'
  | 'productivity.task' | 'productivity.application' | 'productivity.completion'
  | 'identity.profile_update' | 'identity.verification'
  | 'social.post' | 'social.comment' | 'social.endorsement'
  | 'compliance.incident' | 'compliance.violation';

export interface ActionReceiptInput extends ReceiptInput {
  action_category?: ActionCategory;
  action_type?: string;
}

export interface TrustVector {
  E: number;
  P: number;
  B: number;
  D: number;
  R: number;
  A: number;
  C: number;
}

export interface TrustProfileResult {
  trust_vector: TrustVector | null;
  reputation: ReputationResult | null;
  computed_at: string | null;
}

export function submitActionReceipt(client: CoinPayClient, receipt: ActionReceiptInput): Promise<{ success: boolean; receipt?: Record<string, unknown>; error?: string }>;
export function getTrustProfile(client: CoinPayClient, agentDid: string): Promise<TrustProfileResult>;

export interface DidInfo {
  did: string;
  public_key: string;
  verified: boolean;
  created_at: string;
}

export function getMyDid(client: CoinPayClient): Promise<DidInfo>;
export function claimDid(client: CoinPayClient): Promise<DidInfo>;
export function linkDid(client: CoinPayClient, params: { did: string; publicKey: string; signature: string }): Promise<DidInfo>;

// Platform Issuer Self-Service

export interface PlatformIssuer {
  id: string;
  did: string;
  name: string;
  domain: string;
  active: boolean;
  api_key: string | null;
  created_at: string;
}

export function registerPlatformIssuer(client: CoinPayClient, params: { name: string; domain: string; did?: string }): Promise<{ success: boolean; issuer: PlatformIssuer; api_key: string }>;
export function listPlatformIssuers(client: CoinPayClient): Promise<{ success: boolean; issuers: PlatformIssuer[] }>;
export function rotatePlatformApiKey(client: CoinPayClient, issuerId: string): Promise<{ success: boolean; issuer: PlatformIssuer; api_key: string }>;
export function deactivatePlatformIssuer(client: CoinPayClient, issuerId: string): Promise<{ success: boolean; issuer: PlatformIssuer }>;
