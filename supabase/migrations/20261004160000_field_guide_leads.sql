-- Private lead capture for the complimentary founder's field guide.
-- Apply this migration before enabling the homepage promotion.
create table if not exists public.field_guide_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  email text not null check (char_length(email) between 3 and 254),
  name text not null check (char_length(name) between 1 and 100),
  company text not null check (char_length(company) between 1 and 200),
  region text not null check (char_length(region) between 1 and 160),
  role text not null default '',
  guide_slug text not null,
  marketing_consent boolean not null default false,
  consultation_interest boolean not null default false,
  privacy_notice_version text not null,
  consent_recorded_at timestamptz not null default now(),
  email_verified_at timestamptz,
  source text not null,
  utm jsonb not null default '{}'::jsonb,
  unique (email, guide_slug)
);
alter table public.field_guide_leads enable row level security;
revoke all on public.field_guide_leads from public, anon, authenticated;
grant select, delete on public.field_guide_leads to service_role;

create table if not exists public.field_guide_rate_limits (
  key text primary key,
  count integer not null,
  expires_at timestamptz not null
);
alter table public.field_guide_rate_limits enable row level security;
revoke all on public.field_guide_rate_limits from public, anon, authenticated;

create or replace function public.record_field_guide_lead(
  p_name text, p_email text, p_company text, p_region text, p_role text,
  p_slug text, p_marketing boolean, p_consultation boolean, p_notice text,
  p_source text, p_utm jsonb, p_ip_hash text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_keys text[] := array['ip:' || p_ip_hash, 'email:' || md5(lower(p_email)), 'global'];
  v_limits integer[] := array[5, 1, 500];
  v_seconds integer[] := array[900, 900, 86400];
  v_count integer;
  i integer;
begin
  -- Low-volume lead endpoint: one transaction-wide lock makes all three
  -- limits atomic across application replicas. No in-memory fail-open path.
  perform pg_advisory_xact_lock(hashtextextended('coinpay-field-guide-leads', 0));
  delete from public.field_guide_rate_limits where expires_at <= now();
  for i in 1..3 loop
    insert into public.field_guide_rate_limits(key, count, expires_at)
      values(v_keys[i], 1, now() + make_interval(secs => v_seconds[i]))
      on conflict (key) do update set count = field_guide_rate_limits.count + 1
      returning count into v_count;
    if v_count > v_limits[i] then
      raise exception 'field_guide_rate_limit' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.field_guide_leads
    (name, email, company, region, role, guide_slug, marketing_consent,
     consultation_interest, privacy_notice_version, source, utm)
  values
    (p_name, lower(p_email), p_company, p_region, p_role, p_slug,
     coalesce(p_marketing, false), coalesce(p_consultation, false), p_notice, p_source, p_utm)
  on conflict (email, guide_slug) do update set
    name = excluded.name, company = excluded.company, region = excluded.region,
    role = excluded.role, marketing_consent = excluded.marketing_consent,
    consultation_interest = excluded.consultation_interest,
    privacy_notice_version = excluded.privacy_notice_version,
    consent_recorded_at = now(), requested_at = now(), source = excluded.source, utm = excluded.utm
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_field_guide_lead(text,text,text,text,text,text,boolean,boolean,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.record_field_guide_lead(text,text,text,text,text,text,boolean,boolean,text,text,jsonb,text) to service_role;

comment on table public.field_guide_leads is 'Private PDF requests. Marketing preference is not email verification. Do not enroll unverified addresses in campaigns.';
