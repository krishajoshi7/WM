-- Custody evidence integrity hardening.
-- NOT VALID keeps existing historical/demo rows from blocking deployment, while
-- still enforcing these checks for every new insert or update after migration.

alter table public.custody_events
drop constraint if exists custody_events_photo_required_for_handoff;

alter table public.custody_events
add constraint custody_events_photo_required_for_handoff
check (
  event_type not in ('pickup_scanned', 'delivered')
  or nullif(btrim(photo_url), '') is not null
) not valid;

alter table public.custody_events
drop constraint if exists custody_events_weight_verified_positive;

alter table public.custody_events
add constraint custody_events_weight_verified_positive
check (weight_verified_kg is null or weight_verified_kg > 0) not valid;

alter table public.custody_events
drop constraint if exists custody_events_gps_pair;

alter table public.custody_events
add constraint custody_events_gps_pair
check (
  (location_lat is null and location_lng is null)
  or (location_lat is not null and location_lng is not null)
) not valid;

create or replace function public.record_custody_scan(
  p_batch_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_location_lat numeric default null,
  p_location_lng numeric default null,
  p_photo_url text default null,
  p_weight_verified_kg numeric default null,
  p_notes text default null
)
returns public.waste_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.waste_batches%rowtype;
  v_expected_role text;
  v_required_status text;
  v_next_status text;
begin
  case p_event_type
    when 'pickup_scanned' then
      v_expected_role := 'collector';
      v_required_status := 'assigned';
      v_next_status := 'picked_up';
    when 'in_transit' then
      v_expected_role := 'collector';
      v_required_status := 'picked_up';
      v_next_status := 'in_transit';
    when 'delivered' then
      v_expected_role := 'recycler';
      v_required_status := 'in_transit';
      v_next_status := 'delivered';
    else
      raise exception 'Unsupported scan event %', p_event_type;
  end case;

  if p_event_type in ('pickup_scanned', 'delivered') and coalesce(btrim(p_photo_url), '') = '' then
    raise exception 'Photo proof is required for % custody events', p_event_type;
  end if;

  if (p_location_lat is null) <> (p_location_lng is null) then
    raise exception 'GPS latitude and longitude must be provided together';
  end if;

  if p_weight_verified_kg is not null and p_weight_verified_kg <= 0 then
    raise exception 'Verified weight must be greater than zero';
  end if;

  perform public.assert_actor_role(p_actor_id, v_expected_role);

  select *
    into v_batch
    from public.waste_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'Batch not found';
  end if;

  if v_batch.status <> v_required_status then
    raise exception 'Invalid transition from % using event %', v_batch.status, p_event_type;
  end if;

  if v_expected_role = 'collector' and not exists (
    select 1
      from public.pickup_requests
     where batch_id = p_batch_id
       and collector_id = p_actor_id
       and status = 'accepted'
  ) then
    raise exception 'Collector has not accepted this pickup';
  end if;

  insert into public.custody_events (
    batch_id,
    actor_id,
    event_type,
    location_lat,
    location_lng,
    photo_url,
    weight_verified_kg,
    notes
  )
  values (
    p_batch_id,
    p_actor_id,
    p_event_type,
    p_location_lat,
    p_location_lng,
    nullif(btrim(p_photo_url), ''),
    p_weight_verified_kg,
    p_notes
  );

  if p_event_type = 'in_transit' then
    update public.pickup_requests
       set status = 'completed'
     where batch_id = p_batch_id
       and collector_id = p_actor_id;
  end if;

  update public.waste_batches
     set status = v_next_status
   where id = p_batch_id
   returning * into v_batch;

  return v_batch;
end;
$$;

grant execute on function public.record_custody_scan(uuid, uuid, text, numeric, numeric, text, numeric, text) to authenticated, service_role;

create or replace function public.health_check_custody_evidence_constraints()
returns text[]
language sql
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(array_agg(conname::text order by conname), '{}'::text[])
    from pg_constraint
   where conname in (
     'custody_events_photo_required_for_handoff',
     'custody_events_weight_verified_positive',
     'custody_events_gps_pair'
   );
$$;

grant execute on function public.health_check_custody_evidence_constraints() to authenticated, service_role;
