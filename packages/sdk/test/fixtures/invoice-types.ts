import {
  CoinPayClient,
  InvoiceStatus,
  createInvoice,
  deleteInvoice,
  getInvoice,
  getInvoicePaymentData,
  listInvoices,
  sendInvoice,
  updateInvoice,
  type CreateInvoiceParams,
  type Invoice,
  type ListInvoicesParams,
  type UpdateInvoiceParams,
} from '../../src/index.js';

declare const client: CoinPayClient;

const createParams: CreateInvoiceParams = {
  amount: 25,
  currency: 'USD',
};
const listParams: ListInvoicesParams = { status: InvoiceStatus.DRAFT };
const updates: UpdateInvoiceParams = { notes: 'Updated terms' };

const created: Promise<Invoice> = createInvoice(client, createParams);
const fetched: Promise<Invoice> = getInvoice(client, 'inv_123');
const listed: Promise<{ invoices: Invoice[]; total?: number }> = listInvoices(client, listParams);
const updated: Promise<Invoice> = updateInvoice(client, 'inv_123', updates);

void created;
void fetched;
void listed;
void updated;
void deleteInvoice(client, 'inv_123');
void sendInvoice(client, 'inv_123');
void getInvoicePaymentData(client, 'inv_123');
