/**
 * Persistence for USD accounts, behind an interface.
 *
 * What is NOT here is the point: no balance column, no ledger, no full account
 * number. The service logic is tested against {@link MemoryUsdAccountStore},
 * which enforces the same unique constraints as the migration
 * (20261122160000_usd_accounts.sql), because those constraints are what make
 * account requests and webhook deliveries idempotent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DepositRail, HolderStatus, UsdAccountStatus, UsdAccountEvent } from './types';

export interface UsdAccountHolderRow {
  id: string;
  merchant_id: string;
  provider: string;
  provider_holder_id: string | null;
  country: string;
  status: HolderStatus;
  provider_status: string | null;
  onboarding_url: string | null;
  rejection_reason: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface UsdAccountRow {
  id: string;
  merchant_id: string;
  holder_id: string;
  provider: string;
  provider_account_id: string | null;
  /** Other partner ids belonging to this account (see UsdAccount.relatedIds). */
  provider_related_ids: string[];
  status: UsdAccountStatus;
  provider_status: string | null;
  bank_name: string | null;
  routing_number: string | null;
  /** Last four only. There is deliberately no column for the full number. */
  account_last4: string | null;
  rails: DepositRail[];
  destination_asset: string;
  destination_chain: string;
  destination_address: string;
  idempotency_key: string;
  last_error: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsdAccountEventRow {
  id: string;
  provider: string;
  event_id: string;
  event_type: UsdAccountEvent['type'];
  provider_type: string;
  merchant_id: string | null;
  usd_account_id: string | null;
  provider_account_id: string | null;
  provider_holder_id: string | null;
  provider_deposit_id: string | null;
  /** USD cents as reported by the partner. A record, never a balance. */
  amount_minor: number | null;
  currency: string | null;
  rail: DepositRail | null;
  delivered_amount_atomic: string | null;
  delivered_asset: string | null;
  delivered_chain: string | null;
  tx_hash: string | null;
  return_code: string | null;
  occurred_at: string | null;
  payload: unknown;
  received_at: string;
}

export type NewHolderRow = Pick<
  UsdAccountHolderRow,
  'merchant_id' | 'provider' | 'country' | 'idempotency_key'
>;
export type HolderPatch = Partial<
  Pick<UsdAccountHolderRow, 'provider_holder_id' | 'status' | 'provider_status' | 'onboarding_url' | 'rejection_reason' | 'country'>
>;
export type NewAccountRow = Pick<
  UsdAccountRow,
  | 'merchant_id'
  | 'holder_id'
  | 'provider'
  | 'destination_asset'
  | 'destination_chain'
  | 'destination_address'
  | 'idempotency_key'
>;
export type AccountPatch = Partial<
  Pick<
    UsdAccountRow,
    | 'provider_account_id'
    | 'provider_related_ids'
    | 'status'
    | 'provider_status'
    | 'bank_name'
    | 'routing_number'
    | 'account_last4'
    | 'rails'
    | 'last_error'
    | 'opened_at'
    | 'closed_at'
  >
>;
export type NewEventRow = Omit<UsdAccountEventRow, 'id' | 'received_at'>;

/** A unique constraint said no. Callers re-read: someone else got there first. */
export class UsdAccountsConflictError extends Error {
  constructor(what: string) {
    super(`${what} already exists`);
    this.name = 'UsdAccountsConflictError';
  }
}

export interface UsdAccountStore {
  findHolder(merchantId: string, provider: string): Promise<UsdAccountHolderRow | null>;
  findHolderByProviderId(provider: string, providerHolderId: string): Promise<UsdAccountHolderRow | null>;
  /** Throws {@link UsdAccountsConflictError} on (merchant_id, provider). */
  insertHolder(row: NewHolderRow): Promise<UsdAccountHolderRow>;
  updateHolder(id: string, patch: HolderPatch): Promise<UsdAccountHolderRow>;

  findAccount(merchantId: string, provider: string): Promise<UsdAccountRow | null>;
  findAccountByHolder(holderId: string): Promise<UsdAccountRow | null>;
  findAccountByProviderId(provider: string, providerAccountId: string): Promise<UsdAccountRow | null>;
  /** Throws {@link UsdAccountsConflictError} on (merchant_id, provider). */
  insertAccount(row: NewAccountRow): Promise<UsdAccountRow>;
  updateAccount(id: string, patch: AccountPatch): Promise<UsdAccountRow>;

  hasEvent(provider: string, eventId: string): Promise<boolean>;
  /** Returns false when (provider, event_id) was already recorded. */
  insertEvent(row: NewEventRow): Promise<boolean>;
  listDepositEvents(usdAccountId: string, limit: number): Promise<UsdAccountEventRow[]>;
}

const UNIQUE_VIOLATION = '23505';
const DEPOSIT_TYPES = ['deposit.received', 'deposit.converted', 'deposit.delivered', 'deposit.returned'];

export class SupabaseUsdAccountStore implements UsdAccountStore {
  constructor(private readonly supabase: SupabaseClient) {}

  private async one<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T | null> {
    const { data, error } = await query;
    if (error) throw new Error(`${what} failed: ${error.message}`);
    return (data as T | null) ?? null;
  }

  findHolder(merchantId: string, provider: string) {
    return this.one<UsdAccountHolderRow>(
      this.supabase.from('usd_account_holders').select('*').eq('merchant_id', merchantId).eq('provider', provider).maybeSingle(),
      'usd_account_holders read',
    );
  }

  findHolderByProviderId(provider: string, providerHolderId: string) {
    return this.one<UsdAccountHolderRow>(
      this.supabase
        .from('usd_account_holders')
        .select('*')
        .eq('provider', provider)
        .eq('provider_holder_id', providerHolderId)
        .maybeSingle(),
      'usd_account_holders read',
    );
  }

  async insertHolder(row: NewHolderRow): Promise<UsdAccountHolderRow> {
    const { data, error } = await this.supabase.from('usd_account_holders').insert(row).select('*').single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new UsdAccountsConflictError('usd_account_holder');
      throw new Error(`usd_account_holders insert failed: ${error.message}`);
    }
    return data as UsdAccountHolderRow;
  }

  async updateHolder(id: string, patch: HolderPatch): Promise<UsdAccountHolderRow> {
    const { data, error } = await this.supabase
      .from('usd_account_holders')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(`usd_account_holders update failed: ${error.message}`);
    return data as UsdAccountHolderRow;
  }

  findAccount(merchantId: string, provider: string) {
    return this.one<UsdAccountRow>(
      this.supabase.from('usd_accounts').select('*').eq('merchant_id', merchantId).eq('provider', provider).maybeSingle(),
      'usd_accounts read',
    );
  }

  findAccountByHolder(holderId: string) {
    return this.one<UsdAccountRow>(
      this.supabase.from('usd_accounts').select('*').eq('holder_id', holderId).maybeSingle(),
      'usd_accounts read',
    );
  }

  async findAccountByProviderId(provider: string, providerAccountId: string) {
    // The id is interpolated into a PostgREST filter, so only id-shaped values
    // get that far. Partner ids are UUIDs or similar.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(providerAccountId)) return null;
    const { data, error } = await this.supabase
      .from('usd_accounts')
      .select('*')
      .eq('provider', provider)
      .or(`provider_account_id.eq.${providerAccountId},provider_related_ids.cs.{${providerAccountId}}`)
      .limit(1);
    if (error) throw new Error(`usd_accounts read failed: ${error.message}`);
    return ((data as UsdAccountRow[] | null) ?? [])[0] ?? null;
  }

  async insertAccount(row: NewAccountRow): Promise<UsdAccountRow> {
    const { data, error } = await this.supabase.from('usd_accounts').insert(row).select('*').single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new UsdAccountsConflictError('usd_account');
      throw new Error(`usd_accounts insert failed: ${error.message}`);
    }
    return data as UsdAccountRow;
  }

  async updateAccount(id: string, patch: AccountPatch): Promise<UsdAccountRow> {
    const { data, error } = await this.supabase
      .from('usd_accounts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(`usd_accounts update failed: ${error.message}`);
    return data as UsdAccountRow;
  }

  async hasEvent(provider: string, eventId: string): Promise<boolean> {
    const row = await this.one<{ id: string }>(
      this.supabase.from('usd_account_events').select('id').eq('provider', provider).eq('event_id', eventId).maybeSingle(),
      'usd_account_events read',
    );
    return row !== null;
  }

  async insertEvent(row: NewEventRow): Promise<boolean> {
    const { error } = await this.supabase.from('usd_account_events').insert(row);
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`usd_account_events insert failed: ${error.message}`);
    }
    return true;
  }

  async listDepositEvents(usdAccountId: string, limit: number): Promise<UsdAccountEventRow[]> {
    const { data, error } = await this.supabase
      .from('usd_account_events')
      .select('*')
      .eq('usd_account_id', usdAccountId)
      .in('event_type', DEPOSIT_TYPES)
      .order('received_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`usd_account_events list failed: ${error.message}`);
    return (data as UsdAccountEventRow[]) ?? [];
  }
}

/** In-memory store for the tests. Enforces the migration's unique constraints. */
export class MemoryUsdAccountStore implements UsdAccountStore {
  holders = new Map<string, UsdAccountHolderRow>();
  accounts = new Map<string, UsdAccountRow>();
  events = new Map<string, UsdAccountEventRow>();
  private counter = 0;
  now: () => Date = () => new Date();

  private id(prefix: string) {
    return `${prefix}_${++this.counter}`;
  }

  async findHolder(merchantId: string, provider: string) {
    return [...this.holders.values()].find((h) => h.merchant_id === merchantId && h.provider === provider) ?? null;
  }

  async findHolderByProviderId(provider: string, providerHolderId: string) {
    return (
      [...this.holders.values()].find((h) => h.provider === provider && h.provider_holder_id === providerHolderId) ?? null
    );
  }

  async insertHolder(row: NewHolderRow) {
    for (const h of this.holders.values()) {
      if ((h.merchant_id === row.merchant_id && h.provider === row.provider) || h.idempotency_key === row.idempotency_key) {
        throw new UsdAccountsConflictError('usd_account_holder');
      }
    }
    const at = this.now().toISOString();
    const full: UsdAccountHolderRow = {
      ...row,
      id: this.id('uah'),
      provider_holder_id: null,
      status: 'pending',
      provider_status: null,
      onboarding_url: null,
      rejection_reason: null,
      created_at: at,
      updated_at: at,
    };
    this.holders.set(full.id, full);
    return full;
  }

  async updateHolder(id: string, patch: HolderPatch) {
    const row = this.holders.get(id);
    if (!row) throw new Error(`No such holder: ${id}`);
    const next = { ...row, ...patch, updated_at: this.now().toISOString() };
    this.holders.set(id, next);
    return next;
  }

  async findAccount(merchantId: string, provider: string) {
    return [...this.accounts.values()].find((a) => a.merchant_id === merchantId && a.provider === provider) ?? null;
  }

  async findAccountByHolder(holderId: string) {
    return [...this.accounts.values()].find((a) => a.holder_id === holderId) ?? null;
  }

  async findAccountByProviderId(provider: string, providerAccountId: string) {
    return (
      [...this.accounts.values()].find(
        (a) =>
          a.provider === provider &&
          (a.provider_account_id === providerAccountId || a.provider_related_ids.includes(providerAccountId)),
      ) ?? null
    );
  }

  async insertAccount(row: NewAccountRow) {
    for (const a of this.accounts.values()) {
      if ((a.merchant_id === row.merchant_id && a.provider === row.provider) || a.idempotency_key === row.idempotency_key) {
        throw new UsdAccountsConflictError('usd_account');
      }
    }
    const at = this.now().toISOString();
    const full: UsdAccountRow = {
      ...row,
      id: this.id('uac'),
      provider_account_id: null,
      provider_related_ids: [],
      status: 'requested',
      provider_status: null,
      bank_name: null,
      routing_number: null,
      account_last4: null,
      rails: [],
      last_error: null,
      opened_at: null,
      closed_at: null,
      created_at: at,
      updated_at: at,
    };
    this.accounts.set(full.id, full);
    return full;
  }

  async updateAccount(id: string, patch: AccountPatch) {
    const row = this.accounts.get(id);
    if (!row) throw new Error(`No such account: ${id}`);
    const next = { ...row, ...patch, updated_at: this.now().toISOString() };
    this.accounts.set(id, next);
    return next;
  }

  async hasEvent(provider: string, eventId: string) {
    return this.events.has(`${provider}:${eventId}`);
  }

  async insertEvent(row: NewEventRow) {
    const key = `${row.provider}:${row.event_id}`;
    if (this.events.has(key)) return false;
    this.events.set(key, { ...row, id: this.id('uae'), received_at: this.now().toISOString() });
    return true;
  }

  async listDepositEvents(usdAccountId: string, limit: number) {
    return [...this.events.values()]
      .filter((e) => e.usd_account_id === usdAccountId && DEPOSIT_TYPES.includes(e.event_type))
      .sort((a, b) => b.received_at.localeCompare(a.received_at))
      .slice(0, limit);
  }
}
