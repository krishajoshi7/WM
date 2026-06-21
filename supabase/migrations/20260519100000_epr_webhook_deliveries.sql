-- Durable EPR webhook delivery queue.
-- Recycling remains successful even if the external EPR portal is down; failed
-- deliveries are persisted here and can be retried by a scheduled processor.

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_type text not null check (delivery_type in ('epr_recycled')),
  batch_id uuid not null references public.waste_batches(id) on delete cascade,
  idempotency_key text not null unique,
  endpoint_url text not null,
  payload jsonb not null,
  status text not null default 'pending' check (
    status in ('pending','processing','delivered','failed','abandoned')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_status_code integer,
  last_response_body text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_due_idx
on public.webhook_deliveries(status, next_attempt_at)
where status in ('pending','failed');

create index if not exists webhook_deliveries_batch_id_idx
on public.webhook_deliveries(batch_id);

create or replace function public.touch_webhook_delivery_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists webhook_deliveries_touch_updated_at on public.webhook_deliveries;
create trigger webhook_deliveries_touch_updated_at
before update on public.webhook_deliveries
for each row execute function public.touch_webhook_delivery_updated_at();

alter table public.webhook_deliveries enable row level security;

create policy "admins read webhook deliveries"
on public.webhook_deliveries for select
using (public.current_role() = 'admin');

create policy "service role manages webhook deliveries"
on public.webhook_deliveries for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.enqueue_epr_webhook_delivery(
  p_batch_id uuid,
  p_endpoint_url text
)
returns public.webhook_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.waste_batches%rowtype;
  v_log public.recycling_logs%rowtype;
  v_chain jsonb;
  v_delivery public.webhook_deliveries%rowtype;
  v_payload jsonb;
begin
  if coalesce(trim(p_endpoint_url), '') = '' then
    raise exception 'Endpoint URL is required';
  end if;

  select *
    into v_batch
    from public.waste_batches
   where id = p_batch_id;

  if not found then
    raise exception 'Batch not found';
  end if;

  if v_batch.status <> 'recycled' then
    raise exception 'Only recycled batches can be sent to EPR portal';
  end if;

  select *
    into v_log
    from public.recycling_logs
   where batch_id = p_batch_id
   order by created_at desc
   limit 1;

  if not found then
    raise exception 'Recycling log not found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ce) order by ce.created_at), '[]'::jsonb)
    into v_chain
    from public.custody_events ce
   where ce.batch_id = p_batch_id;

  v_payload := jsonb_build_object(
    'batch_code', v_batch.batch_code,
    'recycler_id', v_log.recycler_id,
    'quantity_kg', v_log.quantity_kg,
    'category', v_batch.category,
    'timestamp', now(),
    'custody_chain', v_chain
  );

  insert into public.webhook_deliveries (
    delivery_type,
    batch_id,
    idempotency_key,
    endpoint_url,
    payload,
    status,
    next_attempt_at
  )
  values (
    'epr_recycled',
    p_batch_id,
    'epr-recycled:' || p_batch_id::text,
    p_endpoint_url,
    v_payload,
    'pending',
    now()
  )
  on conflict (idempotency_key)
  do update set
    endpoint_url = excluded.endpoint_url,
    payload = excluded.payload,
    status = case
      when public.webhook_deliveries.status = 'delivered' then public.webhook_deliveries.status
      else 'pending'
    end,
    next_attempt_at = case
      when public.webhook_deliveries.status = 'delivered' then public.webhook_deliveries.next_attempt_at
      else now()
    end,
    last_error = case
      when public.webhook_deliveries.status = 'delivered' then public.webhook_deliveries.last_error
      else null
    end
  returning * into v_delivery;

  return v_delivery;
end;
$$;

create or replace function public.claim_webhook_deliveries(
  p_limit integer default 10
)
returns setof public.webhook_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.webhook_deliveries wd
     set status = 'processing',
         attempts = wd.attempts + 1,
         locked_at = now(),
         last_attempt_at = now()
   where wd.id in (
     select id
       from public.webhook_deliveries
      where status in ('pending','failed')
        and next_attempt_at <= now()
        and attempts < max_attempts
      order by next_attempt_at asc, created_at asc
      for update skip locked
      limit greatest(1, p_limit)
   )
  returning *;
end;
$$;

create or replace function public.mark_webhook_delivery_result(
  p_delivery_id uuid,
  p_delivered boolean,
  p_status_code integer default null,
  p_response_body text default null,
  p_error text default null
)
returns public.webhook_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.webhook_deliveries%rowtype;
  v_next_delay_minutes integer;
begin
  select *
    into v_delivery
    from public.webhook_deliveries
   where id = p_delivery_id
   for update;

  if not found then
    raise exception 'Webhook delivery not found';
  end if;

  if p_delivered then
    update public.webhook_deliveries
       set status = 'delivered',
           delivered_at = now(),
           locked_at = null,
           next_attempt_at = now(),
           last_status_code = p_status_code,
           last_response_body = left(coalesce(p_response_body, ''), 4000),
           last_error = null
     where id = p_delivery_id
     returning * into v_delivery;

    return v_delivery;
  end if;

  v_next_delay_minutes := least(60, greatest(1, power(2, v_delivery.attempts)::integer));

  update public.webhook_deliveries
     set status = case
           when attempts >= max_attempts then 'abandoned'
           else 'failed'
         end,
         locked_at = null,
         next_attempt_at = case
           when attempts >= max_attempts then next_attempt_at
           else now() + make_interval(mins => v_next_delay_minutes)
         end,
         last_status_code = p_status_code,
         last_response_body = left(coalesce(p_response_body, ''), 4000),
         last_error = left(coalesce(p_error, 'Webhook delivery failed'), 1000)
   where id = p_delivery_id
   returning * into v_delivery;

  return v_delivery;
end;
$$;

grant execute on function public.enqueue_epr_webhook_delivery(uuid, text) to authenticated, service_role;
grant execute on function public.claim_webhook_deliveries(integer) to authenticated, service_role;
grant execute on function public.mark_webhook_delivery_result(uuid, boolean, integer, text, text) to authenticated, service_role;
