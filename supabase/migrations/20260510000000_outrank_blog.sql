-- Outrank webhook integrations + blog publishing
-- merchants.is_admin already exists; this just adds the storage and RPC.

-- 1. outrank_integrations: stores webhook access tokens
create table if not exists public.outrank_integrations (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  access_token text not null unique,
  created_by uuid references public.merchants(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  request_count integer not null default 0
);

create index if not exists idx_outrank_integrations_token
  on public.outrank_integrations (access_token);

alter table public.outrank_integrations enable row level security;

drop policy if exists "Service role full access on outrank_integrations" on public.outrank_integrations;
create policy "Service role full access on outrank_integrations"
  on public.outrank_integrations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- 2. blog_posts: ingested articles
create table if not exists public.blog_posts (
  id uuid default gen_random_uuid() primary key,
  source text not null default 'outrank',
  source_id text,
  slug text not null,
  title text not null,
  content_markdown text,
  content_html text,
  meta_description text,
  image_url text,
  tags text[] not null default '{}',
  source_created_at timestamptz,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);

create unique index if not exists idx_blog_posts_slug on public.blog_posts (slug);
create index if not exists idx_blog_posts_published_at on public.blog_posts (published_at desc);
create index if not exists idx_blog_posts_tags on public.blog_posts using gin (tags);

alter table public.blog_posts enable row level security;

drop policy if exists "Anyone can read blog posts" on public.blog_posts;
create policy "Anyone can read blog posts"
  on public.blog_posts
  for select
  using (true);

drop policy if exists "Service role can write blog posts" on public.blog_posts;
create policy "Service role can write blog posts"
  on public.blog_posts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- 3. Atomic counter bump for the outrank webhook
create or replace function public.bump_outrank_integration(integration_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.outrank_integrations
     set last_used_at = now(),
         request_count = request_count + 1
   where id = integration_id;
$$;
revoke execute on function public.bump_outrank_integration(uuid) from public, anon, authenticated;
grant execute on function public.bump_outrank_integration(uuid) to service_role;
