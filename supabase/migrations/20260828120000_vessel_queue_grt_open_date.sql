-- Manual Review · Vessels (no IMO) — tonnage + availability intelligence.
--   · GRT (gross tonnage) is KEY for the Port Module and cost calculations;
--     NRT (net tonnage) secondary. Both sync onto the vessel record
--     (vessels.gross_tonnage / vessels.scnrt).
--   · OPEN DATE + OPEN PORT join DWT as the key matchmaking factors.
--   · imo_hint pre-fills the review dialog when a reference source (the
--     unified workbook) already knows the ship's IMO — the admin confirms.
alter table public.vessel_review_queue add column if not exists grt       integer;
alter table public.vessel_review_queue add column if not exists nrt       integer;
alter table public.vessel_review_queue add column if not exists open_date date;
alter table public.vessel_review_queue add column if not exists imo_hint  text;

-- resolve_vessel_review now carries the tonnage through to the vessel record.
create or replace function public.resolve_vessel_review(p_id uuid, p_imo text default null, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_q public.vessel_review_queue; v_vessel_id uuid; v_op text; v_has_imo boolean;
begin
  select * into v_q from public.vessel_review_queue where id = p_id;
  if v_q.id is null then raise exception 'vessel queue entry % not found', p_id using errcode = 'P0002'; end if;

  v_has_imo := p_imo is not null and length(trim(p_imo)) > 0;

  if v_has_imo then
    insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, gross_tonnage, scnrt)
    values (v_q.vessel_name, trim(p_imo), public.fn_coerce_vessel_type(v_q.vessel_type), v_q.dwt_grain, v_q.built, v_q.flag, v_q.grt, v_q.nrt)
    on conflict (imo_number) do update set
      vessel_name   = excluded.vessel_name,
      dwt_grain     = coalesce(excluded.dwt_grain, public.vessels.dwt_grain),
      build_year    = coalesce(excluded.build_year, public.vessels.build_year),
      flag          = coalesce(excluded.flag, public.vessels.flag),
      gross_tonnage = coalesce(excluded.gross_tonnage, public.vessels.gross_tonnage),
      scnrt         = coalesce(excluded.scnrt, public.vessels.scnrt),
      updated_at    = now()
    returning id into v_vessel_id;
    v_op := 'imo';
  else
    select id into v_vessel_id from public.vessels
    where lower(vessel_name) = lower(v_q.vessel_name)
      and build_year is not distinct from v_q.built
      and dwt_grain  is not distinct from v_q.dwt_grain
      and imo_number is null
    limit 1;
    if v_vessel_id is not null then
      update public.vessels set
        vessel_type   = public.fn_coerce_vessel_type(v_q.vessel_type),
        flag          = coalesce(v_q.flag, flag),
        gross_tonnage = coalesce(v_q.grt, gross_tonnage),
        scnrt         = coalesce(v_q.nrt, scnrt),
        updated_at    = now()
      where id = v_vessel_id;
      v_op := 'composite-update';
    else
      insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, gross_tonnage, scnrt)
      values (v_q.vessel_name, null, public.fn_coerce_vessel_type(v_q.vessel_type), v_q.dwt_grain, v_q.built, v_q.flag, v_q.grt, v_q.nrt)
      returning id into v_vessel_id;
      v_op := 'composite-insert';
    end if;
  end if;

  update public.vessel_review_queue
    set status = 'synced', resolved_vessel_id = v_vessel_id, resolved_with_imo = v_has_imo,
        resolved_by = p_actor, resolved_at = now()
  where id = p_id;

  return jsonb_build_object('vessel_id', v_vessel_id, 'op', v_op);
end $function$;

-- One-time near-duplicate cleanup: the same ship reported twice with a
-- slightly different DWT (SEA RUBY 9,299 vs 9,300) or a missing build year.
-- Keep the fresher sighting, merge its missing scalars from the older one,
-- and mark the older 'ignored'. Placeholder "Unnamed vessel (…)" rows are
-- exempt — different ships can share that name.
do $$
declare r record;
begin
  for r in
    select a.id as keep_id, b.id as drop_id
    from public.vessel_review_queue a
    join public.vessel_review_queue b
      on a.id <> b.id
     and a.status = 'pending' and b.status = 'pending'
     and lower(a.vessel_name) = lower(b.vessel_name)
     and lower(a.vessel_name) not like 'unnamed vessel%'
     and (a.built = b.built or a.built is null or b.built is null)
     and (
       (a.dwt_grain is not null and b.dwt_grain is not null
         and abs(a.dwt_grain - b.dwt_grain) <= greatest(100, a.dwt_grain / 20))
       or a.dwt_grain is null or b.dwt_grain is null
     )
     and (coalesce(a.posted_at, a.created_at), a.id) > (coalesce(b.posted_at, b.created_at), b.id)
  loop
    update public.vessel_review_queue k set
      built        = coalesce(k.built, d.built),
      dwt_grain    = coalesce(k.dwt_grain, d.dwt_grain),
      vessel_type  = coalesce(k.vessel_type, d.vessel_type),
      flag         = coalesce(k.flag, d.flag),
      open_port    = coalesce(k.open_port, d.open_port),
      open_country = coalesce(k.open_country, d.open_country),
      open_zone    = coalesce(k.open_zone, d.open_zone),
      direction    = coalesce(k.direction, d.direction),
      dest_zones   = coalesce(k.dest_zones, d.dest_zones),
      posted_at    = coalesce(k.posted_at, d.posted_at)
    from public.vessel_review_queue d
    where k.id = r.keep_id and d.id = r.drop_id;
    update public.vessel_review_queue set status = 'ignored' where id = r.drop_id;
  end loop;
end $$;
