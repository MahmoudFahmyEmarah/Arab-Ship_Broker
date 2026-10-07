-- ── L1 · a recreated room records the room it continues, through the ledger ─
do $$
declare v jsonb; w jsonb; r jsonb; v_room uuid; v_new uuid; e text; n_rooms int; n_events int;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'lin-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  -- a live source is refused, also when an old key is named (the raw create key)
  e := pg_temp.fx_err(format('select public.recreate_fixture_room(%L, %L::jsonb, %L)', v_room, pg_temp.fx_terms(), 'lin-create-1'));
  if e <> 'FX_IDEMPOTENCY' then raise exception 'L1: a raw create key must not replay as a recreate, got %', e; end if;
  e := pg_temp.fx_err(format('select public.recreate_fixture_room(%L, %L::jsonb, %L)', v_room, pg_temp.fx_terms(), 'lin-recreate-live'));
  if e <> 'FX_STATE' then raise exception 'L1: a live source must be refused, got %', e; end if;
  v := public.close_fixture_room(v_room, 'withdrawn', 'lineage', pg_temp.fx_ver(v_room), 'lin-close-1');
  v := public.recreate_fixture_room(v_room, pg_temp.fx_terms(), 'lin-recreate-1', '{}'::jsonb);
  v_new := (v->'data'->>'roomId')::uuid;
  if v_new is null or v_new = v_room then raise exception 'L1: recreate must open a new room: %', v; end if;
  perform pg_temp.fx_owner();
  if (select supersedes_room_id from public.fixture_rooms where id = v_new) is distinct from v_room then
    raise exception 'L1: the new room must record the room it continues'; end if;
  if (select supersedes_room_id from public.fixture_rooms where id = v_room) is not null then raise exception 'L1: the old room must not point anywhere'; end if;
  -- through the ledger: one room.continued_from event, the returned version is the room's final version
  if (select count(*) from public.fixture_events where room_id = v_new and type = 'room.continued_from' and payload->>'previousRoomId' = v_room::text) <> 1 then
    raise exception 'L1: the lineage must be one ledger event'; end if;
  if (v->>'version')::int <> (select version from public.fixture_rooms where id = v_new) or (v->>'version')::int <> (select max(seq) from public.fixture_events where room_id = v_new) then
    raise exception 'L1: the returned version must be the room''s final version'; end if;
  raise notice 'L1 ok: live source and raw-create key refused; the recreated room records its predecessor through one ledger event at its final version';
end $$;

-- ── L2 · replay, another predecessor, a second successor: refused without any write ─
do $$
declare v jsonb; w jsonb; r jsonb; v_room uuid; v_new uuid; v_other uuid; e text; n_rooms int; n_events int;
begin
  perform pg_temp.fx_owner();
  select x.supersedes_room_id, x.id into v_room, v_new from public.fixture_rooms x where x.create_idempotency_key = 'lin-recreate-1';
  perform pg_temp.fx_as('u_ch1');
  w := public.recreate_fixture_room(v_room, pg_temp.fx_terms(), 'lin-recreate-1', '{}'::jsonb);
  if (w->'data'->>'roomId')::uuid is distinct from v_new or (w->>'replayed')::boolean is not true then raise exception 'L2: a replay returns the same room: %', w; end if;
  r := public.get_fixture_room(v_new);
  if r->'room'->>'supersedesRoomId' is distinct from v_room::text or (w->>'version')::int <> (r->'room'->>'version')::int then
    raise exception 'L2: the replay shows the lineage at the room''s current version'; end if;
  -- another predecessor (a second closed room on another pairing) with the same key
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a4'), pg_temp.fx_terms(), 'lin-create-2', '{}'::jsonb);
  v_other := (v->'data'->>'roomId')::uuid;
  v := public.close_fixture_room(v_other, 'withdrawn', 'lineage', pg_temp.fx_ver(v_other), 'lin-close-2');
  perform pg_temp.fx_owner();
  select count(*), (select count(*) from public.fixture_events) into n_rooms, n_events from public.fixture_rooms;
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.recreate_fixture_room(%L, %L::jsonb, %L)', v_other, pg_temp.fx_terms(), 'lin-recreate-1'));
  if e <> 'FX_IDEMPOTENCY' then raise exception 'L2: a key bound to another predecessor must be refused, got %', e; end if;
  -- a second successor for the same predecessor
  e := pg_temp.fx_err(format('select public.recreate_fixture_room(%L, %L::jsonb, %L)', v_room, pg_temp.fx_terms(), 'lin-recreate-again'));
  if e <> 'FX_STATE' then raise exception 'L2: a second successor must be refused, got %', e; end if;
  perform pg_temp.fx_owner();
  if (select count(*) from public.fixture_rooms) <> n_rooms or (select count(*) from public.fixture_events) <> n_events then
    raise exception 'L2: a refusal must write nothing'; end if;
  if (select count(*) from public.fixture_rooms where supersedes_room_id = v_room) <> 1 then raise exception 'L2: exactly one successor'; end if;
  raise notice 'L2 ok: replay returns the successor at its current version; another predecessor and a second successor are refused with zero writes';
end $$;
