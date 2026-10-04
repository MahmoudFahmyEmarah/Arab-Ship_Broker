-- Voyage Economics · Stream S governance smoke test (4 Oct 2026)
-- for 20261003205000_suez_voyage_governance.sql + 20261003205100_suez_seed_corrections.sql.
--
--   docker exec -i supabase_db_arab-ship-broker psql -U postgres -d <db> -v ON_ERROR_STOP=1 -f - \
--     < supabase/tests/voyage_economics/suez_governance_smoke.sql
--   (or as a --smokes file of scripts/migration-harness.sh)
--
-- BEGIN … ROLLBACK. Run as the database owner. Every block raises on failure;
-- the harness looks for the final "ALL ASSERTIONS PASSED" marker by name.

begin;

-- ── S1 · governed sources: every published version cites a source; on-file sources carry a hash ─
do $$
declare v record; n int;
begin
  for v in select id, version_no from public.suez_tariff_versions where status = 'published' loop
    select count(*) into n from public.suez_tariff_version_sources where version_id = v.id;
    if n = 0 then raise exception 'S1: published version % cites no source record', v.version_no; end if;
  end loop;
  select count(*) into n from public.suez_tariff_sources where evidence_status = 'on_file' and sha256 is null;
  if n > 0 then raise exception 'S1: % on-file source(s) without a SHA-256', n; end if;
  select count(*) into n from public.suez_tariff_sources where evidence_status = 'pending_document';
  raise notice 'S1 ok: every published version is cited; % source(s) still pending a document', n;
end $$;

-- ── S2 · publication validates the data: published versions pass; a malformed draft is refused ─
do $$
declare v record; v_id uuid; v_no int; v_refused boolean := false;
begin
  for v in select id, version_no from public.suez_tariff_versions where status = 'published' loop
    perform public.fn_suez_validate_version(v.id);
  end loop;
  select coalesce(max(version_no), 0) + 1 into v_no from public.suez_tariff_versions;
  insert into public.suez_tariff_versions (version_no, status, effective_from, effective_to, source_ref)
  values (v_no, 'draft', date '2020-01-01', date '2020-03-31', 'smoke draft (rolled back)') returning id into v_id;
  insert into public.suez_tariff_items (version_id, code, label_en, layer, basis, currency, params, direction_scope, cargo_status_scope, payer_party, sort_order, is_active)
  values (v_id, 'smoke_flat_no_amount', 'Smoke: flat without amount', 'fixed', 'flat', 'USD', '{}'::jsonb, 'any', 'any', 'owner', 1, true);
  begin
    update public.suez_tariff_versions set status = 'published' where id = v_id;
  exception when others then
    if sqlerrm not like 'SUEZ_INVALID:%' then raise exception 'S2: expected SUEZ_INVALID, got %', sqlerrm; end if;
    v_refused := true;
  end;
  if not v_refused then raise exception 'S2: a draft with a malformed flat item was published'; end if;
  raise notice 'S2 ok: published versions validate; malformed draft refused at publication';
end $$;

-- ── S3 · published history is immutable; a draft (and its children) can still be removed ─
do $$
declare v_pub uuid; v_pubno int; v_id uuid; v_no int; v_refused boolean; n int;
begin
  select id, version_no into v_pub, v_pubno from public.suez_tariff_versions where status = 'published' order by effective_from desc limit 1;
  if v_pub is null then raise exception 'S3: no published version to test against'; end if;

  v_refused := false;
  begin update public.suez_tariff_versions set source_ref = source_ref || ' (edited)' where id = v_pub;
  exception when others then if sqlerrm like 'SUEZ_IMMUTABLE:%' then v_refused := true; else raise; end if; end;
  if not v_refused then raise exception 'S3: source_ref of published v% could be edited', v_pubno; end if;

  v_refused := false;
  begin delete from public.suez_tariff_versions where id = v_pub;
  exception when others then if sqlerrm like 'SUEZ_IMMUTABLE:%' then v_refused := true; else raise; end if; end;
  if not v_refused then raise exception 'S3: published v% could be deleted', v_pubno; end if;

  v_refused := false;
  begin
    insert into public.suez_tariff_items (version_id, code, label_en, layer, basis, currency, params, direction_scope, cargo_status_scope, payer_party, sort_order, is_active)
    values (v_pub, 'smoke_item', 'Smoke item', 'fixed', 'flat', 'USD', '{"amount": 1}'::jsonb, 'any', 'any', 'owner', 1, true);
  exception when others then if sqlerrm like 'SUEZ_IMMUTABLE:%' then v_refused := true; else raise; end if; end;
  if not v_refused then raise exception 'S3: an item could be added under published v%', v_pubno; end if;

  -- a draft with children is deletable; the cascade must not trip the children guard
  select coalesce(max(version_no), 0) + 1 into v_no from public.suez_tariff_versions;
  insert into public.suez_tariff_versions (version_no, status, effective_from, effective_to, source_ref)
  values (v_no, 'draft', date '2020-06-01', date '2020-06-30', 'smoke draft 2 (rolled back)') returning id into v_id;
  insert into public.suez_tariff_items (version_id, code, label_en, layer, basis, currency, params, direction_scope, cargo_status_scope, payer_party, sort_order, is_active)
  values (v_id, 'smoke_ok', 'Smoke ok', 'fixed', 'flat', 'USD', '{"amount": 1}'::jsonb, 'any', 'any', 'owner', 1, true);
  insert into public.suez_toll_tiers (version_id, vessel_category, cargo_status, tier_order, scnt_from, scnt_to, sdr_per_scnt, confidence)
  values (v_id, 'dry_bulk', 'laden', 0, 0, null, 1.0, 'placeholder');
  delete from public.suez_tariff_versions where id = v_id;
  select count(*) into n from public.suez_tariff_items where version_id = v_id;
  if n <> 0 then raise exception 'S3: draft items survived the cascade'; end if;
  select count(*) into n from public.suez_tariff_events where version_id = v_id and action = 'draft_deleted';
  if n <> 1 then raise exception 'S3: draft deletion left no event (% rows)', n; end if;
  raise notice 'S3 ok: published v% immutable; draft deletion cascades and is logged', v_pubno;
end $$;

-- ── S4 · SDR rates: append-only with events; voided and future rates never feed the context ─
do $$
declare v_id uuid; v_refused boolean; n int; v_ctx jsonb; v_live numeric;
begin
  insert into public.sdr_rates (rate_usd, as_of, source, notes) values (1.234567, current_date, 'smoke', 'rolled back') returning id into v_id;
  select count(*) into n from public.suez_tariff_events where entity = 'sdr_rate' and entity_id = v_id and action = 'recorded';
  if n <> 1 then raise exception 'S4: recording a rate left % event(s)', n; end if;

  v_refused := false;
  begin delete from public.sdr_rates where id = v_id;
  exception when others then if sqlerrm like 'SUEZ_IMMUTABLE:%' then v_refused := true; else raise; end if; end;
  if not v_refused then raise exception 'S4: an SDR rate could be deleted'; end if;

  v_refused := false;
  begin update public.sdr_rates set rate_usd = 1.5 where id = v_id;
  exception when others then if sqlerrm like 'SUEZ_IMMUTABLE:%' then v_refused := true; else raise; end if; end;
  if not v_refused then raise exception 'S4: an SDR rate could be changed in place'; end if;

  v_refused := false;
  begin update public.sdr_rates set voided_at = now() where id = v_id;
  exception when others then if sqlerrm like 'SUEZ_INVALID:%' then v_refused := true; else raise; end if; end;
  if not v_refused then raise exception 'S4: a rate was voided without a reason'; end if;

  -- a future-dated rate must not be selected for today
  insert into public.sdr_rates (rate_usd, as_of, source, notes) values (9.9, current_date + 30, 'smoke-future', 'rolled back');
  v_ctx := public.get_suez_tariff_context(current_date);
  if (v_ctx -> 'sdr' ->> 'rateUsd')::numeric = 9.9 then raise exception 'S4: a future SDR rate was selected for today'; end if;

  -- void today's smoke rate: it disappears from the context, with an event
  update public.sdr_rates set voided_at = now(), void_reason = 'smoke void (rolled back)' where id = v_id;
  select count(*) into n from public.suez_tariff_events where entity = 'sdr_rate' and entity_id = v_id and action = 'voided';
  if n <> 1 then raise exception 'S4: voiding left % event(s)', n; end if;
  v_ctx := public.get_suez_tariff_context(current_date);
  if (v_ctx -> 'sdr' ->> 'id') = v_id::text then raise exception 'S4: a voided rate still feeds the context'; end if;
  select rate_usd into v_live from public.sdr_rates where voided_at is null and as_of <= current_date order by as_of desc, created_at desc limit 1;
  if v_live is null and (v_ctx -> 'sdr') is not null and jsonb_typeof(v_ctx -> 'sdr') <> 'null' then raise exception 'S4: context reports an SDR rate although none is live'; end if;

  v_refused := false;
  begin update public.sdr_rates set void_reason = 'changed' where id = v_id;
  exception when others then if sqlerrm like 'SUEZ_IMMUTABLE:%' then v_refused := true; else raise; end if; end;
  if not v_refused then raise exception 'S4: a voided rate could be changed'; end if;
  raise notice 'S4 ok: SDR rates append-only, voided/future rates excluded, events written';
end $$;

-- ── S5 · member context v2: versioned, sourced, dated ────────────────────────
do $$
declare v_ctx jsonb; v_from date;
begin
  select effective_from into v_from from public.suez_tariff_versions where status = 'published' order by effective_from limit 1;
  v_ctx := public.get_suez_tariff_context(v_from);
  if (v_ctx ->> 'found')::boolean is not true then raise exception 'S5: no context for the first published effective date %', v_from; end if;
  if v_ctx ->> 'algorithmVersion' <> 'suez-engine/2' then raise exception 'S5: algorithmVersion is %', v_ctx ->> 'algorithmVersion'; end if;
  if jsonb_array_length(v_ctx -> 'sources') < 1 then raise exception 'S5: context carries no sources'; end if;
  if jsonb_typeof(v_ctx -> 'items') <> 'array' or jsonb_array_length(v_ctx -> 'items') = 0 then raise exception 'S5: context carries no items'; end if;
  v_ctx := public.get_suez_tariff_context(date '1999-01-01');
  if (v_ctx ->> 'found')::boolean then raise exception 'S5: a context was found for 1999'; end if;
  raise notice 'S5 ok: context v2 found/sourced for %, not found for 1999', v_from;
end $$;

-- ── S6 · ECA geometry: member table read closed, RPCs versioned ─────────────
do $$
declare v_denied boolean := false; n int; z jsonb; s jsonb;
begin
  begin
    set local role authenticated;
    select count(*) into n from public.eca_zones;
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  if not v_denied then raise exception 'S6: the authenticated role can read eca_zones directly'; end if;
  z := public.list_eca_zones(current_date);
  if jsonb_typeof(z) <> 'array' or jsonb_array_length(z) = 0 then raise exception 'S6: list_eca_zones returned nothing'; end if;
  if not exists (select 1 from jsonb_array_elements(z) e where e ->> 'code' = 'MED' and e ->> 'geometryVersion' = 'MED-2026-10-04-r1' and e ->> 'confidence' = 'coarse') then
    raise exception 'S6: MED zone is not labelled MED-2026-10-04-r1 / coarse: %', z;
  end if;
  s := public.fn_route_eca_split('XXAAA', 'XXBBB', current_date);
  if (s ->> 'found')::boolean then raise exception 'S6: a split was found for a non-existent route'; end if;
  if s ->> 'algorithmVersion' <> 'fn_route_eca_split/2' then raise exception 'S6: split algorithmVersion is %', s ->> 'algorithmVersion'; end if;
  raise notice 'S6 ok: eca_zones closed to members; list_eca_zones + fn_route_eca_split/2 versioned';
end $$;

-- ── S7 · settings and events: governed row patched; the trail is append-only ─
do $$
declare v jsonb; v_refused boolean := false; v_id bigint;
begin
  select value into v from public.app_settings where key = 'voyage_settings';
  if v is null then raise exception 'S7: no voyage_settings row'; end if;
  if v -> 'eca' ->> 'distillateProductKey' is null then raise exception 'S7: eca.distillateProductKey missing'; end if;
  select id into v_id from public.suez_tariff_events order by id limit 1;
  if v_id is null then raise exception 'S7: no events at all'; end if;
  begin update public.suez_tariff_events set action = 'tampered' where id = v_id;
  exception when others then v_refused := true; end;
  if not v_refused then raise exception 'S7: an event row could be rewritten'; end if;
  v_refused := false;
  begin delete from public.suez_tariff_events where id = v_id;
  exception when others then v_refused := true; end;
  if not v_refused then raise exception 'S7: an event row could be deleted'; end if;
  raise notice 'S7 ok: settings patched, event trail append-only';
end $$;

-- ── S8 · profile writes need an actor: no session → refused ─────────────────
do $$
declare v_refused boolean := false; v_vessel uuid;
begin
  select id into v_vessel from public.vessels limit 1;
  if v_vessel is null then raise notice 'S8 skipped: no vessels in this database'; return; end if;
  begin
    perform public.upsert_vessel_economics_profile(v_vessel, '{"speedLadenKn": 12}'::jsonb);
  exception when others then v_refused := true;
  end;
  if not v_refused then raise exception 'S8: a profile was written without an authenticated actor'; end if;
  raise notice 'S8 ok: profile write refused without an actor';
end $$;

do $$ begin raise notice 'SUEZ GOVERNANCE SMOKE: ALL ASSERTIONS PASSED'; end $$;

rollback;
