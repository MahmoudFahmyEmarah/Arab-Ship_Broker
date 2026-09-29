-- Run after fixture_room/seed_fixture_shape.sql inside one transaction.
-- This is intentionally a real-RPC smoke: authenticated member claims are
-- used for every command, and owner reads exist only for assertions/setup.

do $$
declare
  v_room uuid;
  v jsonb;
  v_links jsonb;
  v_err text;
  v_estimate uuid := '00000000-0000-4000-8000-0000000000d1';
  v_wrong_estimate uuid := '00000000-0000-4000-8000-0000000000d2';
  v_initial_version integer;
  v_before_link integer;
  v_after_link integer;
  v_before_sync integer;
  v_after_cargo_sync integer;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'shared-create', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  v_initial_version := pg_temp.fx_ver(v_room);
  if v_initial_version < 1 then raise exception 'INT1: room creation did not write its ledger'; end if;

  -- Privileged setup of immutable PDA snapshots; commands below remain member
  -- calls. Manual coverage permits a source-less test estimate.
  perform pg_temp.fx_owner();
  insert into public.pda_estimates (
    id, owner_user_id, port_locode, vessel_id, call_date, coverage, input_snapshot,
    fx_snapshot, warnings, native_currency, native_total, generated_at
  ) values
    (v_estimate, pg_temp.fx_id('u_ch1'), 'ZZFXA', pg_temp.fx_id('v1'), current_date, 'manual_required', '{}'::jsonb,
     '{"rate":1.25,"source":"member"}'::jsonb, '[{"code":"manual"}]'::jsonb, 'USD', 1234.56, now()),
    (v_wrong_estimate, pg_temp.fx_id('u_ch1'), 'ZZFXA', pg_temp.fx_id('v2'), current_date, 'manual_required', '{}'::jsonb,
     '{}'::jsonb, '[]'::jsonb, 'USD', 10, now());

  -- An invited counterparty has no access to shared cost information. Once the
  -- invitation is accepted, the room enters negotiation and a party may link.
  perform pg_temp.fx_as('u_ow1');
  v_err := pg_temp.fx_err(format('select public.list_fixture_pda_links(%L)', v_room));
  if v_err <> 'FX_AUTH' then raise exception 'INT1: invited counterparty must not receive shared PDA headers, got %', v_err; end if;
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'shared-vessel-accept');

  perform pg_temp.fx_as('u_ch1');
  -- A first commercial position makes the room negotiating, the same normal
  -- transition used by the Fixture UI before a cost estimate is shared.
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'freight'), '{"num":25,"currency":"USD"}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'shared-open-negotiation');
  v_before_link := pg_temp.fx_ver(v_room);
  v := public.link_fixture_pda_estimate(v_room, v_estimate, 'load', pg_temp.fx_ver(v_room), 'shared-link-1');
  v_after_link := pg_temp.fx_ver(v_room);
  if v_after_link <> v_before_link + 1 then raise exception 'INT1: PDA link did not advance the ledger exactly once'; end if;
  if v->'data'->'pdaLink'->>'pdaEstimateId' <> v_estimate::text then raise exception 'INT1: PDA link result %', v; end if;
  if v::text ilike '%vesselId%' then raise exception 'INT1: vessel id leaked in PDA command result %', v; end if;
  perform pg_temp.fx_owner();
  if not exists (select 1 from public.fixture_events e where e.room_id = v_room and e.type = 'pda.linked' and not (e.payload ? 'vesselId') and not (e.result ? 'vesselId')) then
    raise exception 'INT1: safe PDA ledger event missing';
  end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.link_fixture_pda_estimate(v_room, v_estimate, 'load', v_before_link, 'shared-link-1');
  if coalesce((v->>'replayed')::boolean, false) is not true or (v->>'version')::int <> v_after_link then
    raise exception 'INT1: PDA replay must preserve the final version: %', v;
  end if;
  v_links := public.list_fixture_pda_links(v_room);
  if jsonb_array_length(v_links) <> 1 or v_links::text ilike '%vesselId%' then raise exception 'INT1: unsafe PDA link read %', v_links; end if;
  if v_links->0->>'callDate' <> current_date::text
     or (v_links->0->>'fxRate')::numeric <> 1.25
     or v_links->0->>'fxSource' <> 'member'
     or (v_links->0->>'warningCount')::integer <> 1 then
    raise exception 'INT1: approved safe PDA header fields were not snapshotted %', v_links;
  end if;

  v_err := pg_temp.fx_err(format('select public.link_fixture_pda_estimate(%L, %L, %L, %s, %L)', v_room, v_wrong_estimate, 'discharge', pg_temp.fx_ver(v_room), 'shared-link-wrong-vessel'));
  if v_err <> 'FX_VALIDATION' then raise exception 'INT1: mismatched PDA vessel must be refused, got %', v_err; end if;

  perform pg_temp.fx_as('u_ow1');
  v_links := public.list_fixture_pda_links(v_room);
  if jsonb_array_length(v_links) <> 1 or v_links->0->>'pdaEstimateId' <> v_estimate::text then raise exception 'INT1: active counterparty cannot read shared PDA header %', v_links; end if;

  -- D4 setup: the function itself makes both authorised writes and all
  -- assertions are against the enum-backed real listing tables.
  perform pg_temp.fx_owner();
  update public.fixture_rooms
     set status = 'on_subjects', listing_sync_target = jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'ON SUBS'), listing_sync_required_at = now()
   where id = v_room;

  perform pg_temp.fx_as('u_ch1');
  v_before_sync := pg_temp.fx_ver(v_room);
  v := public.sync_fixture_listing_status(v_room, pg_temp.fx_ver(v_room), 'shared-sync-cargo');
  v_after_cargo_sync := pg_temp.fx_ver(v_room);
  if v_after_cargo_sync <> v_before_sync + 1 then raise exception 'INT1: cargo sync did not advance the ledger exactly once'; end if;
  if v->'data'->>'cargoUpdated' <> 'true' or v->'data'->>'vesselUpdated' <> 'false' or v->'data'->>'outstanding' <> 'true' then
    raise exception 'INT1: cargo-only listing sync result %', v;
  end if;
  perform pg_temp.fx_owner();
  if (select status::text from public.cargo_listings where id = pg_temp.fx_id('c1')) <> 'OUT'
     or (select status::text from public.vessel_availability where id = pg_temp.fx_id('a1')) <> 'OPEN' then
    raise exception 'INT1: cargo sync changed the wrong listing';
  end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.sync_fixture_listing_status(v_room, v_before_sync, 'shared-sync-cargo');
  if coalesce((v->>'replayed')::boolean, false) is not true or (v->>'version')::int <> v_after_cargo_sync then
    raise exception 'INT1: listing sync replay must preserve final version %', v;
  end if;

  perform pg_temp.fx_as('u_ow1');
  v := public.sync_fixture_listing_status(v_room, pg_temp.fx_ver(v_room), 'shared-sync-vessel');
  if v->'data'->>'cargoUpdated' <> 'false' or v->'data'->>'vesselUpdated' <> 'true' or v->'data'->>'outstanding' <> 'false' then
    raise exception 'INT1: vessel-only listing sync result %', v;
  end if;
  perform pg_temp.fx_owner();
  if (select status::text from public.vessel_availability where id = pg_temp.fx_id('a1')) <> 'ON SUBS' then
    raise exception 'INT1: vessel status was not synchronised';
  end if;

  perform pg_temp.fx_as('u_out');
  v_err := pg_temp.fx_err(format('select public.sync_fixture_listing_status(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'shared-sync-outsider'));
  if v_err <> 'FX_AUTH' then raise exception 'INT1: outsider sync must be refused, got %', v_err; end if;

  perform pg_temp.fx_owner();
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'fixture_pda_links' and column_name ilike '%vessel%'
  ) then raise exception 'INT1: a vessel identifier column exists on fixture_pda_links'; end if;
  raise notice 'FIXTURE + PDA SHARED INTEGRATION: ALL ASSERTIONS PASSED';
end $$;
