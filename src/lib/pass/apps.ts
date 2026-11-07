/**
 * The Profullstack properties a user can sign in to with one click.
 *
 * A property is an active OAuth client owned by the Profullstack account
 * (FIRST_PARTY_OAUTH_OWNER_ID) with an https callback. Picking one on /pass
 * records consent for it, so "Sign in with CoinPay" there goes straight
 * through instead of stopping on the consent screen.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Never pre-approved: these still ask on the consent screen every time. */
export const NEVER_PREAPPROVE = new Set(['merchant']);

export interface PassApp {
  host: string;
  name: string;
  url: string;
  client_ids: string[];
  scopes: string[];
  connected: boolean;
}

interface ClientRow {
  client_id: string;
  name: string;
  redirect_uris: string[] | null;
  scopes: string[] | null;
  created_at?: string;
}

export function firstPartyOwnerId(): string | null {
  return process.env.FIRST_PARTY_OAUTH_OWNER_ID?.trim() || null;
}

export function preapprovableScopes(scopes: string[] | null | undefined): string[] {
  const out = (scopes ?? []).filter((s) => !NEVER_PREAPPROVE.has(s));
  if (!out.includes('openid')) out.unshift('openid');
  return out;
}

/** Group clients by the host they redirect to; skip loopback and preview hosts. */
export function groupApps(clients: ClientRow[], consented: Set<string>): PassApp[] {
  const byHost = new Map<string, PassApp>();
  for (const c of clients) {
    const first = (c.redirect_uris ?? []).find((u) => u.startsWith('https://'));
    if (!first) continue;
    let url: URL;
    try {
      url = new URL(first);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (host === 'coinpayportal.com' || host.endsWith('.up.railway.app') || host.endsWith('.vercel.app')) continue;
    const scopes = preapprovableScopes(c.scopes);
    const app = byHost.get(host);
    if (app) {
      app.client_ids.push(c.client_id);
      app.scopes = [...new Set([...app.scopes, ...scopes])];
      app.connected = app.connected && consented.has(c.client_id);
    } else {
      byHost.set(host, {
        host,
        name: host,
        url: `https://${host}/`,
        client_ids: [c.client_id],
        scopes,
        connected: consented.has(c.client_id),
      });
    }
  }
  return [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host));
}

export async function listPassApps(supabase: SupabaseClient, userId: string | null): Promise<PassApp[]> {
  const owner = firstPartyOwnerId();
  if (!owner) return [];
  const { data: clients } = await supabase
    .from('oauth_clients')
    .select('client_id, name, redirect_uris, scopes, created_at')
    .eq('owner_id', owner)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  const consented = new Set<string>();
  if (userId) {
    const { data } = await supabase.from('oauth_consents').select('client_id').eq('user_id', userId);
    for (const r of data ?? []) consented.add(r.client_id);
  }
  return groupApps((clients ?? []) as ClientRow[], consented);
}

/**
 * Pre-approve the chosen properties for this user. Only first-party clients
 * are accepted, and an existing consent keeps any scope it already had.
 */
export async function connectPassApps(
  supabase: SupabaseClient,
  userId: string,
  hosts: string[],
): Promise<{ connected: string[] }> {
  const apps = await listPassApps(supabase, userId);
  const wanted = new Set(hosts.map((h) => h.toLowerCase()));
  const chosen = apps.filter((a) => wanted.has(a.host));
  if (chosen.length === 0) return { connected: [] };

  const clientIds = chosen.flatMap((a) => a.client_ids);
  const { data: clientRows } = await supabase
    .from('oauth_clients')
    .select('client_id, scopes')
    .in('client_id', clientIds);
  const { data: existing } = await supabase
    .from('oauth_consents')
    .select('client_id, scopes')
    .eq('user_id', userId)
    .in('client_id', clientIds);
  const had = new Map<string, string[]>((existing ?? []).map((r) => [r.client_id, r.scopes ?? []]));

  const rows = (clientRows ?? []).map((c: { client_id: string; scopes: string[] | null }) => ({
    user_id: userId,
    client_id: c.client_id,
    scopes: [...new Set([...(had.get(c.client_id) ?? []), ...preapprovableScopes(c.scopes)])],
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await supabase.from('oauth_consents').upsert(rows, { onConflict: 'user_id,client_id' });
    if (error) throw new Error(error.message);
  }
  return { connected: chosen.map((a) => a.host) };
}
