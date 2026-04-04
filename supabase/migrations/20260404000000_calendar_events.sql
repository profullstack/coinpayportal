-- Calendar events table for business calendars
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  color text not null default '#8b5cf6',
  external_calendar_id text,
  external_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index idx_calendar_events_business on calendar_events(business_id);
create index idx_calendar_events_user on calendar_events(user_id);
create index idx_calendar_events_start on calendar_events(start_at);

-- RLS
alter table calendar_events enable row level security;

create policy "Users can view calendar events for their businesses"
  on calendar_events for select
  using (
    user_id = auth.uid()
    or business_id in (
      select id from businesses where merchant_id = auth.uid()
    )
  );

create policy "Users can insert calendar events for their businesses"
  on calendar_events for insert
  with check (
    business_id in (
      select id from businesses where merchant_id = auth.uid()
    )
  );

create policy "Users can update their own calendar events"
  on calendar_events for update
  using (
    user_id = auth.uid()
    or business_id in (
      select id from businesses where merchant_id = auth.uid()
    )
  );

create policy "Users can delete their own calendar events"
  on calendar_events for delete
  using (
    user_id = auth.uid()
    or business_id in (
      select id from businesses where merchant_id = auth.uid()
    )
  );

-- Updated_at trigger
create or replace function update_calendar_events_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger calendar_events_updated_at
  before update on calendar_events
  for each row
  execute function update_calendar_events_updated_at();
