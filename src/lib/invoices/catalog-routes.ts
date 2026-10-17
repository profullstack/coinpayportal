import { NextRequest, NextResponse } from 'next/server';
import {
  CATALOG_TABLES,
  type CatalogTable,
  authorizeCatalog,
  authorizeCatalogRow,
  parseCatalogBody,
  checkTaxRateOwner,
  clearOtherDefaults,
} from './catalog';

type IdContext = { params: Promise<{ id: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

async function readJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** GET (list) + POST (create) for /api/<table>. */
export function collectionRoutes(table: CatalogTable) {
  const { columns, order } = CATALOG_TABLES[table];

  async function GET(request: NextRequest) {
    const params = new URL(request.url).searchParams;
    const auth = await authorizeCatalog(request, params.get('business_id'), 'business.read');
    if (!auth.ok) return auth.response;
    let query = auth.supabase.from(table).select(columns).eq('business_id', auth.businessId).order(order);
    if (table === 'invoice_items' && params.get('include_archived') !== 'true') {
      query = query.eq('archived', false);
    }
    const { data, error } = await query;
    if (error) return bad('Failed to load', 500);
    return NextResponse.json({ success: true, [table]: data ?? [] });
  }

  async function POST(request: NextRequest) {
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Expected a JSON object');
    const { business_id, ...fields } = body as Record<string, unknown>;
    const auth = await authorizeCatalog(request, business_id as string | undefined, 'invoice.write');
    if (!auth.ok) return auth.response;
    const parsed = parseCatalogBody(table, fields, false);
    if (!parsed.ok) return bad(parsed.error);
    if (!(await checkTaxRateOwner(auth.supabase, auth.businessId, parsed.data.tax_rate_id))) {
      return bad('tax_rate_id does not belong to this business');
    }
    const { data, error } = await auth.supabase
      .from(table)
      .insert({ ...parsed.data, business_id: auth.businessId })
      .select(columns)
      .single();
    if (error || !data) return bad('Failed to create', 500);
    const row = data as unknown as { id: string; is_default?: boolean };
    if (row.is_default) await clearOtherDefaults(auth.supabase, auth.businessId, row.id);
    return NextResponse.json({ success: true, [singular(table)]: data }, { status: 201 });
  }

  return { GET, POST };
}

/** GET + PATCH + DELETE for /api/<table>/[id]. */
export function itemRoutes(table: CatalogTable) {
  const { columns } = CATALOG_TABLES[table];

  async function GET(request: NextRequest, { params }: IdContext) {
    const { id } = await params;
    const auth = await authorizeCatalogRow(request, table, id, 'business.read');
    if (!auth.ok) return auth.response;
    const { data } = await auth.supabase.from(table).select(columns).eq('id', id).single();
    return NextResponse.json({ success: true, [singular(table)]: data });
  }

  async function PATCH(request: NextRequest, { params }: IdContext) {
    const { id } = await params;
    const auth = await authorizeCatalogRow(request, table, id, 'invoice.write');
    if (!auth.ok) return auth.response;
    const body = await readJson(request);
    const parsed = parseCatalogBody(table, body, true);
    if (!parsed.ok) return bad(parsed.error);
    if (!(await checkTaxRateOwner(auth.supabase, auth.businessId, parsed.data.tax_rate_id))) {
      return bad('tax_rate_id does not belong to this business');
    }
    const { data, error } = await auth.supabase
      .from(table)
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(columns)
      .single();
    if (error || !data) return bad('Failed to update', 500);
    if (parsed.data.is_default === true) await clearOtherDefaults(auth.supabase, auth.businessId, id);
    return NextResponse.json({ success: true, [singular(table)]: data });
  }

  async function DELETE(request: NextRequest, { params }: IdContext) {
    const { id } = await params;
    const auth = await authorizeCatalogRow(request, table, id, 'invoice.write');
    if (!auth.ok) return auth.response;
    // Invoices keep a copy of each line, so deleting a catalog entry never
    // changes an invoice already issued.
    const { error } = await auth.supabase.from(table).delete().eq('id', id);
    if (error) return bad('Failed to delete', 500);
    return NextResponse.json({ success: true });
  }

  return { GET, PATCH, DELETE };
}

function singular(table: CatalogTable) {
  return table === 'tax_rates' ? 'tax_rate' : 'invoice_item';
}
