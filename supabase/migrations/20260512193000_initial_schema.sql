create extension if not exists "pgcrypto";

create sequence if not exists waste_batch_code_seq start 1;

create or replace function next_batch_code()
returns text
language plpgsql
as $$
declare
  seq_value bigint;
begin
  seq_value := nextval('waste_batch_code_seq');
  return 'WM-' || extract(year from now())::text || '-' || lpad(seq_value::text, 5, '0');
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('generator','collector','recycler','admin')),
  company_name text not null,
  phone text,
  gst_number text,
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  created_at timestamptz not null default now()
);

create table if not exists public.waste_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text unique not null,
  generator_id uuid not null references public.profiles(id),
  waste_type text not null check (waste_type in ('plastic','e-waste','metal','glass','organic')),
  category text not null,
  weight_kg numeric not null check (weight_kg > 0),
  pickup_address text not null,
  pickup_date date not null,
  images text[] not null default '{}',
  qr_token text not null,
  status text not null default 'pending' check (status in (
    'pending','assigned','picked_up','in_transit','delivered','recycled'
  )),
  created_at timestamptz not null default now()
);

create table if not exists public.custody_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.waste_batches(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  event_type text not null check (event_type in (
    'qr_generated','pickup_accepted','pickup_scanned',
    'in_transit','delivered','recycled','rejected'
  )),
  location_lat numeric,
  location_lng numeric,
  photo_url text,
  weight_verified_kg numeric,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.recycling_logs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.waste_batches(id) on delete cascade,
  recycler_id uuid not null references public.profiles(id),
  material_type text not null,
  quantity_kg numeric not null check (quantity_kg > 0),
  recycling_method text not null,
  epr_credits_claimed numeric not null default 0,
  report_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.waste_batches(id) on delete cascade,
  collector_id uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','completed')),
  accepted_at timestamptz,
  estimated_pickup timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, collector_id)
);

create index if not exists waste_batches_generator_id_idx on public.waste_batches(generator_id);
create index if not exists waste_batches_status_idx on public.waste_batches(status);
create index if not exists waste_batches_batch_code_idx on public.waste_batches(batch_code);
create index if not exists custody_events_batch_id_created_at_idx on public.custody_events(batch_id, created_at);
create index if not exists pickup_requests_collector_id_idx on public.pickup_requests(collector_id);
create index if not exists recycling_logs_recycler_id_idx on public.recycling_logs(recycler_id);

create or replace function prevent_custody_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'custody_events is append-only';
end;
$$;

drop trigger if exists custody_events_append_only_update on public.custody_events;
create trigger custody_events_append_only_update
before update on public.custody_events
for each row execute function prevent_custody_event_mutation();

drop trigger if exists custody_events_append_only_delete on public.custody_events;
create trigger custody_events_append_only_delete
before delete on public.custody_events
for each row execute function prevent_custody_event_mutation();

alter table public.profiles enable row level security;
alter table public.waste_batches enable row level security;
alter table public.custody_events enable row level security;
alter table public.recycling_logs enable row level security;
alter table public.pickup_requests enable row level security;

create or replace function public.current_role()
returns text
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create policy "profiles can read own profile"
on public.profiles for select
using (id = auth.uid() or public.current_role() = 'admin');

create policy "profiles can update own contact fields"
on public.profiles for update
using (id = auth.uid() or public.current_role() = 'admin')
with check (id = auth.uid() or public.current_role() = 'admin');

create policy "generators read own batches"
on public.waste_batches for select
using (
  generator_id = auth.uid()
  or public.current_role() = 'admin'
  or (public.current_role() = 'collector' and status in ('pending','assigned','picked_up','in_transit'))
  or (public.current_role() = 'recycler' and status in ('in_transit','delivered','recycled'))
);

create policy "generators create own batches"
on public.waste_batches for insert
with check (generator_id = auth.uid() and public.current_role() = 'generator');

create policy "role-scoped batch status updates"
on public.waste_batches for update
using (
  public.current_role() = 'admin'
  or (
    public.current_role() = 'collector'
    and (
      status = 'pending'
      or exists (
        select 1 from public.pickup_requests pr
        where pr.batch_id = waste_batches.id
          and pr.collector_id = auth.uid()
          and pr.status in ('accepted','completed')
      )
    )
  )
  or (
    public.current_role() = 'recycler'
    and status in ('in_transit','delivered')
  )
)
with check (
  public.current_role() = 'admin'
  or (
    public.current_role() = 'collector'
    and status in ('assigned','picked_up','in_transit')
  )
  or (
    public.current_role() = 'recycler'
    and status in ('delivered','recycled')
  )
);

create policy "custody read by participants"
on public.custody_events for select
using (
  public.current_role() = 'admin'
  or actor_id = auth.uid()
  or exists (
    select 1 from public.waste_batches wb
    where wb.id = custody_events.batch_id
      and wb.generator_id = auth.uid()
  )
);

create policy "custody insert by approved actors"
on public.custody_events for insert
with check (actor_id = auth.uid() and public.current_role() in ('generator','collector','recycler','admin'));

create policy "pickup read assigned or available"
on public.pickup_requests for select
using (collector_id = auth.uid() or public.current_role() = 'admin');

create policy "pickup insert collectors"
on public.pickup_requests for insert
with check (collector_id = auth.uid() and public.current_role() = 'collector');

create policy "pickup update collectors"
on public.pickup_requests for update
using (collector_id = auth.uid() or public.current_role() = 'admin')
with check (collector_id = auth.uid() or public.current_role() = 'admin');

create policy "recycling logs read"
on public.recycling_logs for select
using (
  recycler_id = auth.uid()
  or public.current_role() = 'admin'
  or exists (
    select 1 from public.waste_batches wb
    where wb.id = recycling_logs.batch_id
      and wb.generator_id = auth.uid()
  )
);

create policy "recycling logs insert recyclers"
on public.recycling_logs for insert
with check (recycler_id = auth.uid() and public.current_role() = 'recycler');

insert into storage.buckets (id, name, public)
values ('batch-images', 'batch-images', true)
on conflict (id) do nothing;

create policy "batch images are public"
on storage.objects for select
using (bucket_id = 'batch-images');

create policy "authenticated users upload batch images"
on storage.objects for insert
with check (bucket_id = 'batch-images' and auth.role() = 'authenticated');

alter publication supabase_realtime add table public.waste_batches;
alter publication supabase_realtime add table public.custody_events;
