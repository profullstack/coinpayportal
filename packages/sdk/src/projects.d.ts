import type { CoinPayClient } from './client.js';

export interface AgingRow {
  currency: string;
  current: number;
  '1_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
  total: number;
}

export interface ArAging {
  as_of: string;
  totals: AgingRow[];
  clients: Array<AgingRow & { client_id: string | null; name: string; invoices: number }>;
}

export interface InvoiceSettings {
  business_id: string;
  reminders_enabled: boolean;
  reminder_days: number[];
  late_fee_type: 'none' | 'percent' | 'fixed';
  late_fee_value: number | null;
  late_fee_after_days: number;
  brand_color: string | null;
  logo_url: string | null;
  invoice_footer: string | null;
}

export interface Project {
  id: string;
  business_id: string;
  client_id: string | null;
  name: string;
  hourly_rate: number | null;
  currency: string;
  budget_hours: number | null;
  status: 'active' | 'archived';
}

export interface ProjectStats {
  hours: number;
  billable_hours: number;
  unbilled_amount: number;
  billed_amount: number;
  paid_amount: number;
}

export interface TimeEntry {
  id: string;
  project_id: string;
  description: string;
  started_at: string;
  ended_at: string | null;
  /** null while the timer is running */
  minutes: number | null;
  billable: boolean;
  hourly_rate: number | null;
  invoice_id: string | null;
}

export function getArAging(client: CoinPayClient, options?: { businessId?: string }): Promise<ArAging>;
export function getInvoiceSettings(client: CoinPayClient, options?: { businessId?: string }): Promise<InvoiceSettings>;
export function updateInvoiceSettings(
  client: CoinPayClient,
  options: { businessId?: string } & Partial<Omit<InvoiceSettings, 'business_id'>>
): Promise<InvoiceSettings>;
export function createClientPortalLink(client: CoinPayClient, clientId: string): Promise<string>;
export function revokeClientPortalLink(client: CoinPayClient, clientId: string): Promise<Record<string, unknown>>;
export function listProjects(client: CoinPayClient, options?: { businessId?: string; includeArchived?: boolean }): Promise<Project[]>;
export function getProject(client: CoinPayClient, id: string): Promise<{ project: Project; stats: ProjectStats }>;
export function createProject(
  client: CoinPayClient,
  options: { businessId?: string; name: string; clientId?: string; hourlyRate?: number; currency?: string; budgetHours?: number; notes?: string }
): Promise<Project>;
export function logTime(
  client: CoinPayClient,
  options: { projectId: string; minutes: number; description?: string; billable?: boolean; hourlyRate?: number; startedAt?: string }
): Promise<TimeEntry>;
export function startTimer(client: CoinPayClient, options: { projectId: string; description?: string }): Promise<TimeEntry>;
export function stopTimer(client: CoinPayClient, options?: { entryId?: string; businessId?: string }): Promise<TimeEntry>;
export function listTimeEntries(
  client: CoinPayClient,
  options?: { projectId?: string; businessId?: string; unbilled?: boolean }
): Promise<TimeEntry[]>;
export function invoiceProjectTime(
  client: CoinPayClient,
  projectId: string,
  options?: { entryIds?: string[] }
): Promise<{ invoice: { id: string; invoice_number: string; amount: number }; entries_billed: number }>;
