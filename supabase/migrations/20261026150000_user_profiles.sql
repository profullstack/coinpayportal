-- The shared @profullstack/profile fields in the package's own table, keyed by
-- merchants.id. Private: RLS on with no policies and no anon/authenticated
-- grants, so only the service role (the Next server) reads or writes it.
--
-- Apply on dev2 (no automatic migration step):
--   docker exec -i coinpayportal-com-supabase-db psql -U postgres -d postgres -1 < this file
--   then: notify pgrst, 'reload schema';
-- Additive and idempotent.

create table if not exists public.user_profiles (
  "user_id" uuid primary key references public.merchants (id) on delete cascade,
  "email" text,
  "first_name" text,
  "last_name" text,
  "company_domain" text,
  "job_title" text,
  "linkedin_url" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);
create index if not exists "user_profiles_email" on public.user_profiles (lower("email"));
create index if not exists "user_profiles_company_domain" on public.user_profiles ("company_domain");

alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon, authenticated;
grant all on public.user_profiles to service_role;

-- One-time backfill, idempotent, never overwriting a value already present.
-- merchants.name is split into first/last only when it reads as a person's
-- "First Last" (capitalised words of letters) with no business or bot words;
-- brands, handles and single words are left alone.
insert into public.user_profiles as up (user_id, email, first_name, last_name)
select m.id,
       lower(m.email),
       case when n.ok then split_part(n.name, ' ', 1) end,
       case when n.ok then nullif(btrim(substr(n.name, length(split_part(n.name, ' ', 1)) + 1)), '') end
  from public.merchants m
  cross join lateral (
    select regexp_replace(btrim(m.name), '\s+', ' ', 'g') as name,
           coalesce(
             regexp_replace(btrim(m.name), '\s+', ' ', 'g') ~ '^[[:upper:]][[:alpha:]''’-]*( [[:upper:]][[:alpha:]''’.-]*)+$'
             and m.name !~* '\m(inc|llc|ltd|limited|corp|co|gmbh|labs?|studio|shop|store|crypto|coin|pay|payments?|team|services?|solutions?|agent|ai|bot|test|tech|digital|media|group|games?|network|wallet|exchange|dao|finance|capital|ventures?|global|official|admin|support|merchant|pentest|gpt|radar|demo)\M',
             false) as ok
  ) n
on conflict (user_id) do update
   set email      = coalesce(up.email, excluded.email),
       first_name = coalesce(up.first_name, excluded.first_name),
       last_name  = coalesce(up.last_name, excluded.last_name);
