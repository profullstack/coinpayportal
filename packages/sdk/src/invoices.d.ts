import type { CoinPayClient } from './client.js';

export const InvoiceStatus: {
  readonly DRAFT: 'draft';
  readonly SENT: 'sent';
  readonly PAID: 'paid';
  readonly OVERDUE: 'overdue';
  readonly CANCELLED: 'cancelled';
};

export type InvoiceStatusType = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export interface Invoice {
  id: string;
  invoiceNumber?: string;
  businessId?: string;
  clientId?: string;
  currency?: string;
  amount?: number;
  cryptoCurrency?: string;
  cryptoAmount?: string | number;
  status?: InvoiceStatusType;
  dueDate?: string;
  notes?: string;
  walletId?: string;
  merchantWalletAddress?: string;
  paymentAddress?: string;
  stripeCheckoutUrl?: string;
  paidAt?: string;
  sentAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateInvoiceParams {
  businessId?: string;
  clientId?: string;
  currency: string;
  amount: number;
  cryptoCurrency?: string;
  dueDate?: string;
  notes?: string;
  walletId?: string;
  merchantWalletAddress?: string;
}

export interface ListInvoicesParams {
  businessId?: string;
  status?: InvoiceStatusType;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface UpdateInvoiceParams {
  amount?: number;
  currency?: string;
  cryptoCurrency?: string;
  dueDate?: string;
  notes?: string;
  clientId?: string;
  walletId?: string;
  merchantWalletAddress?: string;
}

export interface ListInvoicesResult {
  invoices: Invoice[];
  total?: number;
}

export function createInvoice(client: CoinPayClient, options: CreateInvoiceParams): Promise<Invoice>;
export function listInvoices(client: CoinPayClient, filters?: ListInvoicesParams): Promise<ListInvoicesResult>;
export function getInvoice(client: CoinPayClient, id: string): Promise<Invoice>;
export function updateInvoice(client: CoinPayClient, id: string, updates: UpdateInvoiceParams): Promise<Invoice>;
export function deleteInvoice(client: CoinPayClient, id: string): Promise<Record<string, unknown>>;
export function sendInvoice(client: CoinPayClient, id: string): Promise<Record<string, unknown>>;
export function getInvoicePaymentData(client: CoinPayClient, id: string): Promise<Record<string, unknown>>;
