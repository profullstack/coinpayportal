import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const login = z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
const githubSource = z
  .object({
    provider: z.literal('github'),
    repository: z
      .string()
      .max(140)
      .regex(/^[a-z\d-]+\/[a-z\d_.-]+$/i)
      .refine((value) => !['.', '..'].includes(value.split('/')[1])),
    thread_number: z.number().int().positive().safe(),
    comment_id: z.number().int().positive().safe(),
    actor_id: z.number().int().positive().safe(),
    actor_login: login,
    payer_login: login,
  })
  .strict();

const nullableText = z.string().max(512).nullable().optional();
const keyedRequest = z.object({
  client_id: z.string().uuid().nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .default('USD'),
  amount: z
    .number()
    .finite()
    .min(0.01)
    .max(999999999.99)
    .refine((n) => n === Math.round(n * 100) / 100, 'Use at most two decimals'),
  crypto_currency: z.string().max(32).nullable().optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  wallet_id: z.string().uuid().nullable().optional(),
  merchant_wallet_address: nullableText,
  source_reference: githubSource.optional(),
  source_rate_limit: z.number().int().min(1).max(1000).optional(),
  schedule: z
    .object({
      recurrence: z.enum([
        'daily',
        'weekly',
        'biweekly',
        'monthly',
        'quarterly',
        'yearly',
        'custom',
      ]),
      custom_interval_days: z.number().int().positive().max(2147483647).nullable().optional(),
      end_date: z.string().datetime({ offset: true }).nullable().optional(),
      max_occurrences: z.number().int().positive().max(2147483647).nullable().optional(),
    })
    .strict()
    .refine(
      (s) => s.recurrence !== 'custom' || !!s.custom_interval_days,
      'custom recurrence requires custom_interval_days'
    )
    .nullable()
    .optional(),
});

export class InvoiceCreationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function creationIdentity(keyHeader: string | null, body: Record<string, unknown>) {
  const source =
    body.source_reference === undefined ? undefined : githubSource.safeParse(body.source_reference);
  if (source && !source.success) {
    throw new InvoiceCreationError(
      400,
      'INVALID_SOURCE_REFERENCE',
      'Invalid GitHub source reference'
    );
  }
  if (keyHeader === null) return { source: source?.data };
  const key = keyHeader.trim();
  if (!/^[\x21-\x7e]{1,255}$/.test(key)) {
    throw new InvoiceCreationError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must contain 1-255 printable non-space ASCII characters'
    );
  }
  const parsed = keyedRequest.safeParse(body);
  if (!parsed.success) {
    throw new InvoiceCreationError(
      400,
      'INVALID_INVOICE_REQUEST',
      'Invalid idempotent invoice request: ' + parsed.error.issues[0].message
    );
  }
  const input = parsed.data;
  // Hash requested terms, not mutable business settings or resolved wallet defaults.
  const terms = {
    client_id: input.client_id || null,
    currency: input.currency,
    amount: input.amount,
    crypto_currency: input.crypto_currency || null,
    due_date: input.due_date || null,
    notes: input.notes || null,
    wallet_id: input.wallet_id || null,
    merchant_wallet_address: input.merchant_wallet_address?.trim() || null,
    source_reference: input.source_reference || null,
    schedule: input.schedule
      ? {
          recurrence: input.schedule.recurrence,
          custom_interval_days: input.schedule.custom_interval_days || null,
          end_date: input.schedule.end_date || null,
          max_occurrences: input.schedule.max_occurrences || null,
        }
      : null,
  };
  return {
    key,
    hash: createHash('sha256').update(JSON.stringify(terms)).digest('hex'),
    source: source?.data,
    sourceRateLimit: input.source_reference ? (input.source_rate_limit ?? 20) : undefined,
  };
}

export const CREATED_INVOICE_SELECT =
  '*, clients (id, name, email, company_name), businesses (id, name)';

function logDatabaseFailure(operation: string, error?: { code?: string }) {
  // Database messages/details can contain invoice terms or wallet addresses.
  const code = error?.code;
  console.error('Invoice creation database failure', {
    operation,
    code: code && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(code) ? code : 'UNKNOWN',
  });
}

export async function loadCreatedInvoice(supabase: SupabaseClient, businessId: string, id: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select(CREATED_INVOICE_SELECT)
    .eq('business_id', businessId)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDatabaseFailure('load', error);
    throw new InvoiceCreationError(
      503,
      'INVOICE_LOOKUP_FAILED',
      'Could not load invoice; retry with the same key'
    );
  }
  if (!data)
    throw new InvoiceCreationError(
      410,
      'INVOICE_DELETED',
      'The original invoice was deleted; this key cannot create another'
    );
  return data;
}

export async function findCreatedInvoice(
  supabase: SupabaseClient,
  businessId: string,
  key: string,
  hash: string
) {
  const { data, error } = await supabase
    .from('invoice_creation_requests')
    .select('request_hash, invoice_id')
    .eq('business_id', businessId)
    .eq('idempotency_key', key)
    .maybeSingle();
  if (error) {
    logDatabaseFailure('lookup', error);
    throw new InvoiceCreationError(
      503,
      'IDEMPOTENCY_UNAVAILABLE',
      'Invoice idempotency is unavailable; retry later'
    );
  }
  if (!data) return null;
  if (data.request_hash !== hash) {
    throw new InvoiceCreationError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'This key was already used with different invoice terms'
    );
  }
  if (!data.invoice_id)
    throw new InvoiceCreationError(
      410,
      'INVOICE_DELETED',
      'The original invoice was deleted; this key cannot create another'
    );
  return loadCreatedInvoice(supabase, businessId, data.invoice_id);
}

export async function createInvoiceOnce(
  supabase: SupabaseClient,
  businessId: string,
  key: string,
  hash: string,
  invoice: Record<string, unknown>,
  schedule: unknown,
  sourceRateLimit?: number
) {
  const { data, error } = await supabase.rpc('create_idempotent_invoice', {
    p_business_id: businessId,
    p_key: key,
    p_request_hash: hash,
    p_invoice: invoice,
    p_schedule: schedule || null,
    p_repository_hourly_limit: sourceRateLimit ?? null,
  });
  if (error) {
    const status =
      error.code === 'PT409'
        ? 409
        : error.code === 'PT410'
          ? 410
          : error.code === 'PT429'
            ? 429
            : 503;
    if (status === 503) logDatabaseFailure('create', error);
    throw new InvoiceCreationError(
      status,
      status === 409
        ? 'IDEMPOTENCY_CONFLICT'
        : status === 410
          ? 'INVOICE_DELETED'
          : status === 429
            ? 'SOURCE_RATE_LIMIT'
            : 'INVOICE_CREATE_FAILED',
      status === 409
        ? 'This key was already used with different invoice terms'
        : status === 410
          ? 'The original invoice was deleted; this key cannot create another'
          : status === 429
            ? 'Repository invoice rate limit reached; retry later with the same key'
            : 'Could not create invoice; retry with the same key'
    );
  }
  const result = data?.[0];
  if (!result?.invoice_id || typeof result.replayed !== 'boolean') {
    logDatabaseFailure('unconfirmed-create');
    throw new InvoiceCreationError(
      503,
      'INVOICE_CREATE_FAILED',
      'Unconfirmed invoice creation; retry with the same key'
    );
  }
  return {
    invoice: await loadCreatedInvoice(supabase, businessId, result.invoice_id),
    replayed: result.replayed as boolean,
  };
}
