/**
 * Persistence for bank transfers, behind an interface.
 *
 * The money logic in ./service.ts is tested against the in-memory store, so a
 * double-debit bug is caught by a unit test rather than by a customer. The
 * Supabase store is a thin translation with nothing to reason about.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BankAccountType, TransferDirection, TransferStatus } from './types';

export interface BankCounterpartyRow {
  id: string;
  merchant_id: string;
  business_id: string | null;
  provider: string;
  provider_counterparty_id: string;
  holder_name: string;
  account_type: BankAccountType;
  routing_number: string;
  account_last4: string;
  status: 'active' | 'removed';
  /** merchant = the merchant's own account (listed, payable to); payer = a buyer's, used once. */
  role: CounterpartyRole;
  payer_email: string | null;
  created_at: string;
  updated_at: string;
}

export type CounterpartyRole = 'merchant' | 'payer';

/**
 * What a transfer is for. It is what makes a balance computable: payins and
 * funding add to what a merchant may pay out, payouts subtract.
 */
export type TransferKind = 'payin' | 'funding' | 'payout';

export interface BankTransferRow {
  id: string;
  merchant_id: string | null;
  business_id: string | null;
  provider: string;
  provider_transfer_id: string | null;
  direction: TransferDirection;
  kind: TransferKind;
  payment_id: string | null;
  invoice_id: string | null;
  payer_email: string | null;
  amount_minor: number;
  /** Platform fee, minor units. Zero on funding and payout. */
  fee_minor: number;
  /** What the merchant keeps: amount minus fee on a payin, the amount otherwise. */
  net_minor: number;
  currency: string;
  status: TransferStatus;
  provider_status: string | null;
  return_code: string | null;
  counterparty_id: string | null;
  bank_counterparty_id: string | null;
  description: string | null;
  idempotency_key: string;
  created_at: string;
  settled_at: string | null;
  hold_until: string | null;
  completed_at: string | null;
  returned_at: string | null;
  last_polled_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export type NewCounterpartyRow = Omit<BankCounterpartyRow, 'id' | 'created_at' | 'updated_at' | 'status'>;
export type NewTransferRow = Pick<
  BankTransferRow,
  | 'merchant_id'
  | 'business_id'
  | 'provider'
  | 'direction'
  | 'kind'
  | 'payment_id'
  | 'invoice_id'
  | 'payer_email'
  | 'amount_minor'
  | 'fee_minor'
  | 'net_minor'
  | 'currency'
  | 'counterparty_id'
  | 'bank_counterparty_id'
  | 'description'
  | 'idempotency_key'
>;
export type TransferPatch = Partial<
  Omit<BankTransferRow, 'id' | 'idempotency_key' | 'created_at' | 'merchant_id' | 'business_id'>
>;

/** Thrown by insertTransfer when the idempotency key already exists. */
export class DuplicateIdempotencyKeyError extends Error {
  constructor(key: string) {
    super(`A bank transfer with idempotency key ${key} already exists`);
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

export interface BankStore {
  insertCounterparty(row: NewCounterpartyRow): Promise<BankCounterpartyRow>;
  getCounterparty(id: string, merchantId: string): Promise<BankCounterpartyRow | null>;
  listCounterparties(merchantId: string, businessId?: string | null): Promise<BankCounterpartyRow[]>;
  removeCounterparty(id: string, merchantId: string): Promise<boolean>;

  findTransferByIdempotencyKey(key: string): Promise<BankTransferRow | null>;
  /** Inserts, or throws {@link DuplicateIdempotencyKeyError}. The unique index is the guard. */
  insertTransfer(row: NewTransferRow): Promise<BankTransferRow>;
  updateTransfer(id: string, patch: TransferPatch): Promise<BankTransferRow>;
  getTransfer(id: string, merchantId: string): Promise<BankTransferRow | null>;
  listTransfers(
    merchantId: string,
    options?: { businessId?: string | null; limit?: number },
  ): Promise<BankTransferRow[]>;

  /** Transfers not yet terminal: initiated, pending, settled. */
  listInFlight(limit: number): Promise<BankTransferRow[]>;
  /** Completed transfers that settled after `settledAfter` and were not polled since `polledBefore`. */
  listReturnable(settledAfter: string, polledBefore: string, limit: number): Promise<BankTransferRow[]>;

  /** Every transfer that counts towards a merchant's balance (all kinds, all statuses). */
  listLedger(merchantId: string): Promise<BankTransferRow[]>;
  /** Payin transfers for one payment or invoice, newest first. */
  listPayinsFor(ref: { paymentId?: string | null; invoiceId?: string | null }): Promise<BankTransferRow[]>;
}

const IN_FLIGHT: readonly TransferStatus[] = ['initiated', 'pending', 'settled'];

/** Postgres unique_violation, as PostgREST reports it. */
const UNIQUE_VIOLATION = '23505';

export class SupabaseBankStore implements BankStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async insertCounterparty(row: NewCounterpartyRow): Promise<BankCounterpartyRow> {
    const { data, error } = await this.supabase
      .from('bank_counterparties')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new Error(`bank_counterparties insert failed: ${error.message}`);
    return data as BankCounterpartyRow;
  }

  async getCounterparty(id: string, merchantId: string): Promise<BankCounterpartyRow | null> {
    const { data, error } = await this.supabase
      .from('bank_counterparties')
      .select('*')
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (error) throw new Error(`bank_counterparties read failed: ${error.message}`);
    return (data as BankCounterpartyRow | null) ?? null;
  }

  async listCounterparties(merchantId: string, businessId?: string | null): Promise<BankCounterpartyRow[]> {
    let query = this.supabase
      .from('bank_counterparties')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .eq('role', 'merchant')
      .order('created_at', { ascending: false });
    if (businessId) query = query.eq('business_id', businessId);
    const { data, error } = await query;
    if (error) throw new Error(`bank_counterparties list failed: ${error.message}`);
    return (data as BankCounterpartyRow[]) ?? [];
  }

  async removeCounterparty(id: string, merchantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('bank_counterparties')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .select('id');
    if (error) throw new Error(`bank_counterparties remove failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async findTransferByIdempotencyKey(key: string): Promise<BankTransferRow | null> {
    const { data, error } = await this.supabase
      .from('bank_transfers')
      .select('*')
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw new Error(`bank_transfers read failed: ${error.message}`);
    return (data as BankTransferRow | null) ?? null;
  }

  async insertTransfer(row: NewTransferRow): Promise<BankTransferRow> {
    const { data, error } = await this.supabase
      .from('bank_transfers')
      .insert({ ...row, status: 'initiated' })
      .select('*')
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new DuplicateIdempotencyKeyError(row.idempotency_key);
      throw new Error(`bank_transfers insert failed: ${error.message}`);
    }
    return data as BankTransferRow;
  }

  async updateTransfer(id: string, patch: TransferPatch): Promise<BankTransferRow> {
    const { data, error } = await this.supabase
      .from('bank_transfers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(`bank_transfers update failed: ${error.message}`);
    return data as BankTransferRow;
  }

  async getTransfer(id: string, merchantId: string): Promise<BankTransferRow | null> {
    const { data, error } = await this.supabase
      .from('bank_transfers')
      .select('*')
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (error) throw new Error(`bank_transfers read failed: ${error.message}`);
    return (data as BankTransferRow | null) ?? null;
  }

  async listTransfers(
    merchantId: string,
    options: { businessId?: string | null; limit?: number } = {},
  ): Promise<BankTransferRow[]> {
    let query = this.supabase
      .from('bank_transfers')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .limit(options.limit ?? 50);
    if (options.businessId) query = query.eq('business_id', options.businessId);
    const { data, error } = await query;
    if (error) throw new Error(`bank_transfers list failed: ${error.message}`);
    return (data as BankTransferRow[]) ?? [];
  }

  async listInFlight(limit: number): Promise<BankTransferRow[]> {
    const { data, error } = await this.supabase
      .from('bank_transfers')
      .select('*')
      .in('status', [...IN_FLIGHT])
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`bank_transfers in-flight read failed: ${error.message}`);
    return (data as BankTransferRow[]) ?? [];
  }

  async listReturnable(settledAfter: string, polledBefore: string, limit: number): Promise<BankTransferRow[]> {
    const { data, error } = await this.supabase
      .from('bank_transfers')
      .select('*')
      .eq('status', 'completed')
      .gte('settled_at', settledAfter)
      .or(`last_polled_at.is.null,last_polled_at.lt.${polledBefore}`)
      .order('last_polled_at', { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) throw new Error(`bank_transfers returnable read failed: ${error.message}`);
    return (data as BankTransferRow[]) ?? [];
  }

  async listLedger(merchantId: string): Promise<BankTransferRow[]> {
    const { data, error } = await this.supabase
      .from('bank_transfers')
      .select('*')
      .eq('merchant_id', merchantId)
      .limit(5000);
    if (error) throw new Error(`bank_transfers ledger read failed: ${error.message}`);
    return (data as BankTransferRow[]) ?? [];
  }

  async listPayinsFor(ref: { paymentId?: string | null; invoiceId?: string | null }): Promise<BankTransferRow[]> {
    let query = this.supabase.from('bank_transfers').select('*').eq('kind', 'payin');
    if (ref.paymentId) query = query.eq('payment_id', ref.paymentId);
    else if (ref.invoiceId) query = query.eq('invoice_id', ref.invoiceId);
    else return [];
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(`bank_transfers payin read failed: ${error.message}`);
    return (data as BankTransferRow[]) ?? [];
  }
}

/**
 * The in-memory store the service tests run against.
 *
 * It enforces the same uniqueness the database does, because that constraint
 * is the money-safety guard and a store that let a duplicate through would
 * make the tests prove nothing.
 */
export class MemoryBankStore implements BankStore {
  counterparties = new Map<string, BankCounterpartyRow>();
  transfers = new Map<string, BankTransferRow>();
  private counter = 0;
  now: () => Date = () => new Date();

  private nextId(prefix: string): string {
    return `${prefix}_${++this.counter}`;
  }

  async insertCounterparty(row: NewCounterpartyRow): Promise<BankCounterpartyRow> {
    const at = this.now().toISOString();
    const full: BankCounterpartyRow = {
      ...row,
      id: this.nextId('bcp'),
      status: 'active',
      created_at: at,
      updated_at: at,
    };
    this.counterparties.set(full.id, full);
    return full;
  }

  async getCounterparty(id: string, merchantId: string): Promise<BankCounterpartyRow | null> {
    const row = this.counterparties.get(id);
    return row && row.merchant_id === merchantId ? row : null;
  }

  async listCounterparties(merchantId: string, businessId?: string | null): Promise<BankCounterpartyRow[]> {
    return [...this.counterparties.values()].filter(
      (row) =>
        row.merchant_id === merchantId &&
        row.status === 'active' &&
        row.role === 'merchant' &&
        (!businessId || row.business_id === businessId),
    );
  }

  async removeCounterparty(id: string, merchantId: string): Promise<boolean> {
    const row = await this.getCounterparty(id, merchantId);
    if (!row || row.status !== 'active') return false;
    this.counterparties.set(id, { ...row, status: 'removed' });
    return true;
  }

  async findTransferByIdempotencyKey(key: string): Promise<BankTransferRow | null> {
    return [...this.transfers.values()].find((row) => row.idempotency_key === key) ?? null;
  }

  async insertTransfer(row: NewTransferRow): Promise<BankTransferRow> {
    // Checked against the map directly, not through findTransferByIdempotencyKey:
    // this is the unique index, and a test that stubs the lookup to stage a
    // race must not be able to disable the index with it.
    for (const existing of this.transfers.values()) {
      if (existing.idempotency_key === row.idempotency_key) {
        throw new DuplicateIdempotencyKeyError(row.idempotency_key);
      }
    }
    const at = this.now().toISOString();
    const full: BankTransferRow = {
      ...row,
      id: this.nextId('btx'),
      provider_transfer_id: null,
      status: 'initiated',
      provider_status: null,
      return_code: null,
      created_at: at,
      settled_at: null,
      hold_until: null,
      completed_at: null,
      returned_at: null,
      last_polled_at: null,
      last_error: null,
      updated_at: at,
    };
    this.transfers.set(full.id, full);
    return full;
  }

  async updateTransfer(id: string, patch: TransferPatch): Promise<BankTransferRow> {
    const row = this.transfers.get(id);
    if (!row) throw new Error(`No such transfer: ${id}`);
    const next = { ...row, ...patch, updated_at: this.now().toISOString() };
    this.transfers.set(id, next);
    return next;
  }

  async getTransfer(id: string, merchantId: string): Promise<BankTransferRow | null> {
    const row = this.transfers.get(id);
    return row && row.merchant_id === merchantId ? row : null;
  }

  async listTransfers(
    merchantId: string,
    options: { businessId?: string | null; limit?: number } = {},
  ): Promise<BankTransferRow[]> {
    return [...this.transfers.values()]
      .filter(
        (row) => row.merchant_id === merchantId && (!options.businessId || row.business_id === options.businessId),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, options.limit ?? 50);
  }

  async listInFlight(limit: number): Promise<BankTransferRow[]> {
    return [...this.transfers.values()]
      .filter((row) => IN_FLIGHT.includes(row.status))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit);
  }

  async listReturnable(settledAfter: string, polledBefore: string, limit: number): Promise<BankTransferRow[]> {
    return [...this.transfers.values()]
      .filter(
        (row) =>
          row.status === 'completed' &&
          row.settled_at !== null &&
          row.settled_at >= settledAfter &&
          (row.last_polled_at === null || row.last_polled_at < polledBefore),
      )
      .slice(0, limit);
  }

  async listLedger(merchantId: string): Promise<BankTransferRow[]> {
    return [...this.transfers.values()].filter((row) => row.merchant_id === merchantId);
  }

  async listPayinsFor(ref: { paymentId?: string | null; invoiceId?: string | null }): Promise<BankTransferRow[]> {
    return [...this.transfers.values()]
      .filter(
        (row) =>
          row.kind === 'payin' &&
          ((ref.paymentId && row.payment_id === ref.paymentId) ||
            (ref.invoiceId && row.invoice_id === ref.invoiceId)),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
