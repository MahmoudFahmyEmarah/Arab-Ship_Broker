-- ── L1 · a recreated room records the room it continues; a replay keeps it ──
do $$
declare v jsonb; w jsonb; r jsonb; v_room uuid; v_new uuid;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'lin-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  v := public.close_fixture_room(v_room, 'withdrawn', 'lineage', pg_temp.fx_ver(v_room), 'lin-close-1');
  v := public.recreate_fixture_room(v_room, pg_temp.fx_terms(), 'lin-recreate-1', '{}'::jsonb);
  v_new := (v->'data'->>'roomId')::uuid;
  if v_new is null or v_new = v_room then raise exception 'L1: recreate must open a new room: %', v; end if;
  perform pg_temp.fx_owner();
  if (select supersedes_room_id from public.fixture_rooms where id = v_new) is distinct from v_room then
    raise exception 'L1: the new room must record the room it continues'; end if;
  if (select supersedes_room_id from public.fixture_rooms where id = v_room) is not null then raise exception 'L1: the old room must not point anywhere'; end if;
  perform pg_temp.fx_as('u_ch1');
  w := public.recreate_fixture_room(v_room, pg_temp.fx_terms(), 'lin-recreate-1', '{}'::jsonb);
  if (w->'data'->>'roomId')::uuid is distinct from v_new or (w->>'replayed')::boolean is not true then raise exception 'L1: a replay returns the same room: %', w; end if;
  r := public.get_fixture_room(v_new);
  if r->'room'->>'supersedesRoomId' is distinct from v_room::text then raise exception 'L1: the room read shows the lineage: %', r->'room'->>'supersedesRoomId'; end if;
  perform pg_temp.fx_owner();
  if (select count(*) from public.fixture_rooms where supersedes_room_id = v_room) <> 1 then raise exception 'L1: exactly one successor'; end if;
  raise notice 'L1 ok: the recreated room records its predecessor; a replay returns the same room and keeps the lineage; the read shows it';
end $$;
