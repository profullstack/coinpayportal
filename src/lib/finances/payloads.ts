import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { getObject, objectExists, sha256Hex } from './files';

/**
 * The provider payload archive: every response, as received, kept
 * encrypted on the private volume with a row here describing the request
 * that produced it. Read-only from the outside; nothing rewrites history.
 */

export interface PayloadRow {
  id: string;
  merchant_id: string;
  connection_id: string;
  job_id: string | null;
  request_class: string;
  provider: string;
  protocol_version: number | null;
  requested_start: string | null;
  requested_end: string | null;
  fetched_at: string;
  bytes: number;
  content_hash: string;
  object_key: string;
  accounts: number;
  transactions: number;
  errors: number;
}

const COLUMNS =
  'id, merchant_id, connection_id, job_id, request_class, provider, protocol_version, requested_start, requested_end, fetched_at, bytes, content_hash, object_key, accounts, transactions, errors';

export function toPublicPayload(p: PayloadRow) {
  return {
    id: p.id,
    connectionId: p.connection_id,
    jobId: p.job_id,
    requestClass: p.request_class,
    provider: p.provider,
    protocolVersion: p.protocol_version,
    requestedStart: p.requested_start,
    requestedEnd: p.requested_end,
    fetchedAt: p.fetched_at,
    bytes: p.bytes,
    sha256: p.content_hash,
    accounts: p.accounts,
    transactions: p.transactions,
    errors: p.errors,
  };
}

export async function listPayloads(
  merchantId: string,
  { connectionId, limit = 50, offset = 0 }: { connectionId?: string | null; limit?: number; offset?: number } = {},
): Promise<{ payloads: PayloadRow[]; total: number }> {
  const supabase = getSupabaseAdmin();
  const l = Math.min(Math.max(limit, 1), 200);
  const o = Math.max(offset, 0);
  let query = supabase
    .from('finance_provider_payloads')
    .select(COLUMNS, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .order('fetched_at', { ascending: false })
    .range(o, o + l - 1);
  if (connectionId) query = query.eq('connection_id', connectionId);
  const { data, error, count } = await query;
  if (error) throw new Error(`Could not list payloads: ${error.message}`);
  return { payloads: (data ?? []) as PayloadRow[], total: count ?? 0 };
}

export async function getPayload(payloadId: string, merchantId: string): Promise<PayloadRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_provider_payloads')
    .select(COLUMNS)
    .eq('id', payloadId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the payload: ${error.message}`);
  return (data as PayloadRow | null) ?? null;
}

export async function readPayloadBytes(payload: PayloadRow): Promise<Buffer> {
  if (!(await objectExists(payload.object_key))) throw new Error('The archived payload is not available on this server');
  const bytes = await getObject(payload.object_key);
  if (sha256Hex(bytes) !== payload.content_hash) throw new Error('The archived payload does not match its recorded hash');
  return bytes;
}
