import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { sendEmail } from '@/lib/email';
import { GUIDE_SLUG, GUIDE_PATH, SUPPORT_EMAIL, NOTICE_VERSION, validateLead, readBoundedJson, guideEmail } from '@/lib/field-guide/lead.mjs';
import { guideAvailable } from '@/lib/field-guide/asset';

export const runtime = 'nodejs';
let db: SupabaseClient | undefined;
const respond = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '900' } : {}) } });

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowedOrigin = origin === 'https://coinpayportal.com' ||
    (process.env.NODE_ENV !== 'production' && origin === new URL(request.url).origin);
  if ((origin && !allowedOrigin) || request.headers.get('sec-fetch-site') === 'cross-site') return respond({ error: 'Cross-site request rejected.' }, 403);

  let lead: ReturnType<typeof validateLead>;
  try { lead = validateLead(await readBoundedJson(request)); }
  catch (error) { return respond({ error: error instanceof Error && !error.message.includes('JSON') ? error.message : 'Please check the form and try again.' }, 400); }
  if (lead.website) return respond({ error: 'Please check the form and try again.' }, 400);

  // Do not collect a lead or promise a download when the release asset is absent.
  if (!(await guideAvailable())) return respond({ error: 'The PDF is temporarily unavailable. Please contact support@coinpayportal.com.' }, 503);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return respond({ error: 'Downloads are temporarily unavailable. Please try again later.' }, 503);

  try {
    db ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    // Ingress must overwrite these headers. Never persist raw IP addresses.
    const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipHash = createHmac('sha256', key).update('field-guide-ip:' + ip).digest('hex');
    const { error } = await db.rpc('record_field_guide_lead', {
      p_name: lead.name, p_email: lead.email, p_company: lead.company, p_region: lead.region,
      p_role: lead.role, p_slug: GUIDE_SLUG, p_marketing: lead.marketingConsent,
      p_consultation: lead.consultationInterest, p_notice: NOTICE_VERSION,
      p_source: lead.source, p_utm: lead.utm, p_ip_hash: ipHash,
    });
    if (error) {
      if (error.message === 'field_guide_rate_limit') return respond({ error: 'Too many requests. Please try again later.' }, 429);
      console.error('[field-guide] Lead storage failed', { code: error.code });
      return respond({ error: 'We could not save your request. Please try again later.' }, 503);
    }
    // Await delivery acceptance; do not fire-and-forget work or claim email arrived.
    let emailAccepted = false;
    try {
      const email = guideEmail(lead.name);
      const result = await sendEmail({ to: lead.email, ...email, replyTo: SUPPORT_EMAIL });
      emailAccepted = result.success;
    } catch { /* The on-page download remains available when the email provider fails. */ }
    return respond({ success: true, downloadUrl: GUIDE_PATH, emailAccepted });
  } catch {
    console.error('[field-guide] Request failed');
    return respond({ error: 'Downloads are temporarily unavailable. Please try again later.' }, 503);
  }
}
