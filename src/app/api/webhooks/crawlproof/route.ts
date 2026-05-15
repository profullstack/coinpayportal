// Crawlproof Autoblog webhook receiver.
//
// Contract: https://crawlproof.com/docs/autoblog-webhook
//
//   POST /api/webhooks/crawlproof
//   Authorization: Bearer <token>          (matches outrank_integrations.access_token where kind='crawlproof')
//   X-Crawlproof-Delivery: <uuid>          (stable across retries — logged for audit only)
//   Content-Type: application/json
//
// Body shape (PRD §7):
//   { event_type: "lx.publish_article", timestamp, data: { article: { ... } } }
//
// Idempotency: the upsert on (source, source_id) gives delivery-level
// dedupe for free — retried deliveries carry the same article.id, so
// no separate dedupe table needed.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/blog';
import { pingWebSubHub } from '@/lib/websub';

type CrawlproofArticle = {
  id?: string;
  title?: string;
  slug?: string;
  content_markdown?: string;
  content_html?: string;
  meta_description?: string;
  image_url?: string | null;
  tags?: string[];
  created_at?: string;
};

type CrawlproofPayload = {
  event_type?: string;
  timestamp?: string;
  data?: { article?: CrawlproofArticle };
};

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return NextResponse.json({ error: 'Missing access token' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: integrations, error: lookupErr } = await supabase
    .from('outrank_integrations')
    .select('id, access_token')
    .eq('kind', 'crawlproof');

  if (lookupErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  const integration = (integrations ?? []).find((row) =>
    tokensMatch(row.access_token, token),
  );
  if (!integration) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 401 });
  }

  let payload: CrawlproofPayload;
  try {
    payload = (await req.json()) as CrawlproofPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (payload.event_type !== 'lx.publish_article') {
    try {
      await supabase.rpc('bump_outrank_integration', { integration_id: integration.id });
    } catch {
      // best-effort
    }
    return NextResponse.json({
      message: 'Event ignored',
      event_type: payload.event_type ?? null,
    });
  }

  const article = payload.data?.article;
  if (!article?.title) {
    return NextResponse.json({ message: 'No article in payload' }, { status: 400 });
  }

  const slug = (article.slug && article.slug.trim()) || slugify(article.title);
  const row = {
    source: 'crawlproof',
    source_id: article.id ?? null,
    slug,
    title: article.title,
    content_markdown: article.content_markdown ?? null,
    content_html: article.content_html ?? null,
    meta_description: article.meta_description ?? null,
    image_url: article.image_url ?? null,
    tags: Array.isArray(article.tags) ? article.tags : [],
    source_created_at: article.created_at ?? null,
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from('blog_posts')
    .upsert([row], { onConflict: 'source,source_id' });

  if (upsertErr) {
    console.error('[crawlproof webhook] upsert failed:', upsertErr);
    return NextResponse.json({ error: 'Failed to persist article' }, { status: 500 });
  }

  try {
    await supabase.rpc('bump_outrank_integration', { integration_id: integration.id });
  } catch {
    // best-effort; ingestion already succeeded
  }

  // WebSub publish notification — fire-and-forget.
  void pingWebSubHub(`${SITE_URL}/blog/rss.xml`);

  return NextResponse.json({ message: 'Webhook processed successfully', slug });
}
