import type { CoinPayClient } from './client.js';

export const InvoiceStatus: {
  readonly DRAFT: 'draft';
  readonly SENT: 'sent';
  readonly PAID: 'paid';
  readonly OVERDUE: 'overdue';
  readonly CANCELLED: 'cancelled';
};

export type InvoiceStatusType = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number | null;
  tax_name?: string | null;
  item_id?: string | null;
}

export interface InvoiceLine extends Required<InvoiceLineInput> {
  /** quantity x unit_price, before discount and tax */
  amount: number;
  discount: number;
  tax: number;
}

export interface InvoiceDiscount {
  type: 'percent' | 'fixed';
  value: number;
}

export interface Invoice {
  id: string;
  invoiceNumber?: string;
  businessId?: string;
  clientId?: string;
  currency?: string;
  amount?: number;
  lineItems?: InvoiceLine[] | null;
  subtotal?: number | null;
  discount?: InvoiceDiscount | null;
  discountTotal?: number | null;
  taxTotal?: number | null;
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
  /** Required unless lineItems is given; the server computes itemised totals. */
  amount?: number;
  lineItems?: InvoiceLineInput[];
  discount?: InvoiceDiscount;
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
  /** Replace the lines; null turns itemising off. */
  lineItems?: InvoiceLineInput[] | null;
  discount?: InvoiceDiscount | null;
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
export function publishInvoice(client: CoinPayClient, id: string): Promise<Record<string, unknown>>;
export function sendInvoice(client: CoinPayClient, id: string): Promise<Record<string, unknown>>;
export function getInvoicePaymentData(client: CoinPayClient, id: string): Promise<Record<string, unknown>>;

export interface TaxRate {
  id: string;
  business_id: string;
  name: string;
  rate: number;
  is_default: boolean;
}

export interface InvoiceItem {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  unit_price: number;
  unit: string | null;
  tax_rate_id: string | null;
  archived: boolean;
}

export function listTaxRates(client: CoinPayClient, options?: { businessId?: string }): Promise<TaxRate[]>;
export function createTaxRate(
  client: CoinPayClient,
  options: { businessId?: string; name: string; rate: number; isDefault?: boolean }
): Promise<TaxRate>;
export function deleteTaxRate(client: CoinPayClient, id: string): Promise<Record<string, unknown>>;
export function listInvoiceItems(client: CoinPayClient, options?: { businessId?: string }): Promise<InvoiceItem[]>;
export function createInvoiceItem(
  client: CoinPayClient,
  options: {
    businessId?: string;
    name: string;
    unitPrice: number;
    description?: string;
    unit?: string;
    taxRateId?: string;
  }
): Promise<InvoiceItem>;
export function deleteInvoiceItem(client: CoinPayClient, id: string): Promise<Record<string, unknown>>;
