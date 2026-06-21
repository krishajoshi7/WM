-- Transactional custody RPCs.
-- These functions keep the legal custody event and the operational batch status
-- in one Postgres transaction, so the app cannot end up with a status change
-- that has no matching audit event.

create or replace function public.assert_actor_role(
  p_actor_id uuid,
  p_expected_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select *
    into v_profile
    from public.profiles
   where id = p_actor_id;

  if not found then
    raise exception 'Actor profile not found';
  end if;

  if v_profile.role <> p_expected_role then
    raise exception 'Actor role %, expected %', v_profile.role, p_expected_role;
  end if;

  if v_profile.status <> 'approved' then
    raise exception 'Actor is not approved';
  end if;
end;
$$;

create or replace function public.accept_pickup_request(
  p_batch_id uuid,
  p_collector_id uuid,
  p_status text,
  p_estimated_pickup timestamptz default null
)
returns public.waste_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.waste_batches%rowtype;
begin
  if p_status not in ('accepted', 'rejected') then
    raise exception 'Invalid pickup status %', p_status;
  end if;

  perform public.assert_actor_role(p_collector_id, 'collector');

  select *
    into v_batch
    from public.waste_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'Batch not found';
  end if;

  if p_status = 'accepted' and v_batch.status <> 'pending' then
    raise exception 'Only pending batches can be accepted';
  end if;

  insert into public.pickup_requests (
    batch_id,
    collector_id,
    status,
    accepted_at,
    estimated_pickup
  )
  values (
    p_batch_id,
    p_collector_id,
    p_status,
    case when p_status = 'accepted' then now() else null end,
    p_estimated_pickup
  )
  on conflict (batch_id, collector_id)
  do update set
    status = excluded.status,
    accepted_at = excluded.accepted_at,
    estimated_pickup = excluded.estimated_pickup;

  insert into public.custody_events (
    batch_id,
    actor_id,
    event_type,
    notes
  )
  values (
    p_batch_id,
    p_collector_id,
    case when p_status = 'accepted' then 'pickup_accepted' else 'rejected' end,
    case
      when p_status = 'accepted' then 'Collector accepted pickup assignment.'
      else 'Collector rejected pickup assignment.'
    end
  );

  if p_status = 'accepted' then
    update public.waste_batches
       set status = 'assigned'
     where id = p_batch_id
     returning * into v_batch;
  end if;

  return v_batch;
end;
$$;

create or replace function public.create_waste_batch_with_event(
  p_id uuid,
  p_batch_code text,
  p_generator_id uuid,
  p_waste_type text,
  p_category text,
  p_weight_kg numeric,
  p_pickup_address text,
  p_pickup_date date,
  p_images text[],
  p_qr_token text
)
returns public.waste_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.waste_batches%rowtype;
begin
  perform public.assert_actor_role(p_generator_id, 'generator');

  insert into public.waste_batches (
    id,
    batch_code,
    generator_id,
    waste_type,
    category,
    weight_kg,
    pickup_address,
    pickup_date,
    images,
    qr_token,
    status
  )
  values (
    p_id,
    p_batch_code,
    p_generator_id,
    p_waste_type,
    p_category,
    p_weight_kg,
    p_pickup_address,
    p_pickup_date,
    coalesce(p_images, '{}'::text[]),
    p_qr_token,
    'pending'
  )
  returning * into v_batch;

  insert into public.custody_events (
    batch_id,
    actor_id,
    event_type,
    notes
  )
  values (
    p_id,
    p_generator_id,
    'qr_generated',
    'Short batch code QR generated; signed JWT stored server-side for scan verification.'
  );

  return v_batch;
end;
$$;

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
    p_photo_url,
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

create or replace function public.complete_recycling(
  p_batch_id uuid,
  p_recycler_id uuid,
  p_material_type text,
  p_quantity_kg numeric,
  p_recycling_method text,
  p_epr_credits_claimed numeric,
  p_report_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.waste_batches%rowtype;
  v_log public.recycling_logs%rowtype;
begin
  if p_quantity_kg is null or p_quantity_kg <= 0 then
    raise exception 'Recycling quantity must be greater than zero';
  end if;

  if coalesce(trim(p_material_type), '') = '' then
    raise exception 'Material type is required';
  end if;

  if coalesce(trim(p_recycling_method), '') = '' then
    raise exception 'Recycling method is required';
  end if;

  perform public.assert_actor_role(p_recycler_id, 'recycler');

  select *
    into v_batch
    from public.waste_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'Batch not found';
  end if;

  if v_batch.status <> 'delivered' then
    raise exception 'Batch must be delivered before recycling';
  end if;

  insert into public.custody_events (
    batch_id,
    actor_id,
    event_type,
    weight_verified_kg,
    notes
  )
  values (
    p_batch_id,
    p_recycler_id,
    'recycled',
    p_quantity_kg,
    p_recycling_method
  );

  insert into public.recycling_logs (
    batch_id,
    recycler_id,
    material_type,
    quantity_kg,
    recycling_method,
    epr_credits_claimed,
    report_url
  )
  values (
    p_batch_id,
    p_recycler_id,
    p_material_type,
    p_quantity_kg,
    p_recycling_method,
    coalesce(p_epr_credits_claimed, 0),
    p_report_url
  )
  returning * into v_log;

  update public.waste_batches
     set status = 'recycled'
   where id = p_batch_id
   returning * into v_batch;

  return jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'log', to_jsonb(v_log)
  );
end;
$$;

grant execute on function public.assert_actor_role(uuid, text) to authenticated, service_role;
grant execute on function public.create_waste_batch_with_event(uuid, text, uuid, text, text, numeric, text, date, text[], text) to authenticated, service_role;
grant execute on function public.accept_pickup_request(uuid, uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.record_custody_scan(uuid, uuid, text, numeric, numeric, text, numeric, text) to authenticated, service_role;
grant execute on function public.complete_recycling(uuid, uuid, text, numeric, text, numeric, text) to authenticated, service_role;
