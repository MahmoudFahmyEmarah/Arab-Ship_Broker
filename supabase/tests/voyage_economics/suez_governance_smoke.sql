-- Voyage Economics · Stream S governance smoke test (4 Oct 2026)
-- for 20261003205000_suez_voyage_governance.sql + 205100 seed corrections + 205400 audit remediation (S9–S12).
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
  if v_ctx ->> 'algorithmVersion' <> 'suez-engine/3' then raise exception 'S5: algorithmVersion is %', v_ctx ->> 'algorithmVersion'; end if;
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
  if s ->> 'algorithmVersion' <> 'fn_route_eca_split/3' then raise exception 'S6: split algorithmVersion is %', s ->> 'algorithmVersion'; end if;
  raise notice 'S6 ok: eca_zones closed to members; list_eca_zones + fn_route_eca_split/3 versioned';
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

-- ── S9 · 205400: publication through the transactional RPC (citation, typed confirmation, open last band, atomic close) ─
do $$
declare
  v_admin uuid; v_id uuid; v_d uuid; r jsonb; v_err text; n int;
  v_open uuid; v_open_from date;
  catch text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s9@arabshipbroker.test') returning id into v_admin;
  insert into public.users (id, supabase_user_id, role, full_name, is_active) values (v_admin, v_admin, 'admin', 'smoke admin S9 (rolled back)', true)
    on conflict (id) do update set supabase_user_id = excluded.supabase_user_id, role = excluded.role, full_name = excluded.full_name, is_active = true;

  r := public.admin_suez_create_version(v_admin, jsonb_build_object('effectiveFrom', '2020-07-01', 'effectiveTo', '2020-07-31', 'sourceRef', 'smoke S9 (rolled back)', 'surchargeRegime', 'unknown'), null);
  v_id := (r ->> 'id')::uuid;
  perform public.admin_suez_save_item(v_id, v_admin, null, '{"code":"smoke_flat","labelEn":"Smoke flat","layer":"fixed","basis":"flat","currency":"USD","params":{"amount":1}}'::jsonb);

  v_err := null; begin perform public.admin_suez_publish(v_id, v_admin, 'PUBLISH'); exception when others then v_err := sqlerrm; end;
  if v_err is null or (v_err not like '%cites no source%' and v_err not like '%official source on file%') then raise exception 'S9: publication without a cited source was not refused (%)', v_err; end if;
  perform public.admin_suez_register_source(v_admin, '{"title":"Smoke source","issuer":"Smoke","authority":"reference","evidenceStatus":"pending_document"}'::jsonb, v_id);
  v_err := null; begin perform public.admin_suez_publish(v_id, v_admin, 'PUBLISH'); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%official source on file%' then raise exception 'S9: official figures published on a pending reference only (%)', v_err; end if;
  perform public.admin_suez_register_source(v_admin, jsonb_build_object('title','Smoke official instrument','issuer','Suez Canal Authority','authority','official','evidenceStatus','on_file','sha256',repeat('a',64)), v_id);

  v_err := null; begin perform public.admin_suez_publish(v_id, v_admin, 'publish'); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'SUEZ_CONFIRM:%' then raise exception 'S9: publication without the typed PUBLISH was not refused (%)', v_err; end if;

  v_err := null; begin perform public.admin_suez_publish(v_id, gen_random_uuid(), 'PUBLISH'); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'SUEZ_ACTOR:%' then raise exception 'S9: an unknown actor could publish (%)', v_err; end if;

  v_err := null;
  begin perform public.admin_suez_replace_tiers(v_id, v_admin, '[{"vessel_category":"dry_bulk","cargo_status":"laden","tier_order":0,"scnt_from":0,"scnt_to":5000,"sdr_per_scnt":8}]'::jsonb, 'official');
  exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%open-ended%' then raise exception 'S9: a finite last toll band was accepted (%)', v_err; end if;
  select count(*) into n from public.suez_toll_tiers where version_id = v_id;
  if n <> 0 then raise exception 'S9: the refused band replacement left % row(s)', n; end if;
  perform public.admin_suez_replace_tiers(v_id, v_admin,
    '[{"vessel_category":"dry_bulk","cargo_status":"laden","tier_order":0,"scnt_from":0,"scnt_to":5000,"sdr_per_scnt":8},{"vessel_category":"dry_bulk","cargo_status":"laden","tier_order":1,"scnt_from":5000,"scnt_to":null,"sdr_per_scnt":6}]'::jsonb, 'official');

  v_err := null;
  begin perform public.admin_suez_save_item(v_id, v_admin, null, '{"code":"smoke_sur","labelEn":"Smoke surcharge","layer":"surcharge","basis":"pct_of_toll","currency":"SDR","params":{"pct":10}}'::jsonb);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'S9: a surcharge without a category scope was accepted'; end if;

  r := public.admin_suez_publish(v_id, v_admin, 'PUBLISH');
  if (select status from public.suez_tariff_versions where id = v_id) <> 'published' then raise exception 'S9: publication did not take effect'; end if;
  select count(*) into n from public.suez_tariff_events where version_id = v_id and actor_user_id = v_admin;
  if n < 5 then raise exception 'S9: expected ≥ 5 events by the acting admin on the version, found %', n; end if;
  v_err := null;
  begin perform public.admin_suez_save_item(v_id, v_admin, null, '{"code":"smoke_late","labelEn":"Smoke late","layer":"fixed","basis":"flat","currency":"USD","params":{"amount":1}}'::jsonb);
  exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'SUEZ_IMMUTABLE:%' then raise exception 'S9: a published version accepted a new item (%)', v_err; end if;

  -- Atomicity: a publication that fails validation leaves the preceding open version open.
  select id, effective_from into v_open, v_open_from from public.suez_tariff_versions
   where status = 'published' and effective_to is null order by effective_from desc limit 1;
  if v_open is not null then
    r := public.admin_suez_create_version(v_admin, jsonb_build_object('effectiveFrom', (v_open_from + 1)::text, 'sourceRef', 'smoke S9 atomic (rolled back)'), null);
    v_d := (r ->> 'id')::uuid;
    perform public.admin_suez_save_item(v_d, v_admin, null, '{"code":"smoke_flat","labelEn":"Smoke flat","layer":"fixed","basis":"flat","currency":"USD","params":{"amount":1}}'::jsonb);
    v_err := null; begin perform public.admin_suez_publish(v_d, v_admin, 'PUBLISH'); exception when others then v_err := sqlerrm; end;
    if v_err is null then raise exception 'S9: an uncited draft published'; end if;
    if (select effective_to from public.suez_tariff_versions where id = v_open) is not null then
      raise exception 'S9: a failed publication still closed the preceding version (not atomic)';
    end if;
  end if;

  if has_table_privilege('service_role', 'public.suez_tariff_items', 'INSERT') or has_table_privilege('service_role', 'public.suez_toll_tiers', 'DELETE')
     or has_table_privilege('service_role', 'public.suez_tariff_versions', 'UPDATE') or has_table_privilege('service_role', 'public.suez_tariff_version_sources', 'INSERT')
     or has_table_privilege('service_role', 'public.eca_zones', 'UPDATE') or has_table_privilege('service_role', 'public.sdr_rates', 'DELETE') then
    raise exception 'S9: the service role can still write a governed tariff table directly';
  end if;
  if not has_function_privilege('service_role', 'public.admin_suez_publish(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_suez_publish(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'S9: admin_suez_publish grants are wrong';
  end if;
  raise notice 'S9 ok: citation, typed PUBLISH, admin actor, open last band, surcharge scope, events in-transaction, atomic close, no direct writes';
end $$;

-- ── S10 · 205400: context v3 carries the surcharge regime; base dues alone are never trusted ─
do $$
declare c jsonb;
begin
  select public.get_suez_tariff_context(effective_from) into c
    from public.suez_tariff_versions where status = 'published' order by effective_from desc limit 1;
  if c is null or not (c -> 'version' ? 'surchargeRegime') or c ->> 'algorithmVersion' <> 'suez-engine/3' then
    raise exception 'S10: the member context does not carry the surcharge regime (%)', c -> 'version';
  end if;
  if exists (select 1 from jsonb_array_elements(c -> 'items') i where not (i ? 'categoryScope' and i ? 'confidence')) then
    raise exception 'S10: context items lack categoryScope/confidence';
  end if;
  raise notice 'S10 ok: context v3 with surcharge regime, category scope and confidence';
end $$;

-- ── S11 · 205400: saved runs — never updated or deleted, statused lines, owner/object checks, anonymised on user deletion ─
do $$
declare
  v_member uuid; v_s9 uuid; v_run uuid; v_err text; n int;
  v_payload jsonb := jsonb_build_object('label', 'smoke S11', 'algorithmVersion', 'voyage-engine/2', 'settingsHash', repeat('a', 64),
    'input', '{}'::jsonb, 'result', '{}'::jsonb, 'totals', '{}'::jsonb,
    'lines', '[{"kind":"cost","code":"canal","label":"Canal","status":"fallback","amountUsd":1}]'::jsonb);
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s11@arabshipbroker.test') returning id into v_member;
  insert into public.users (id, supabase_user_id, role, full_name, is_active) values (v_member, v_member, 'Broker', 'smoke member S11 (rolled back)', true)
    on conflict (id) do update set supabase_user_id = excluded.supabase_user_id, role = excluded.role, full_name = excluded.full_name, is_active = true;
  v_run := public.save_voyage_estimate(v_member, v_payload);
  if (select status from public.voyage_estimate_lines where run_id = v_run and seq = 0) <> 'fallback' then raise exception 'S11: the line status was not persisted'; end if;

  v_err := null; begin perform public.save_voyage_estimate(v_member, jsonb_set(v_payload, '{lines}', '[{"kind":"cost","code":"canal","label":"Canal","amountUsd":1}]'::jsonb)); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'VOYAGE_INVALID:%status%' then raise exception 'S11: a line without a governed status was saved (%)', v_err; end if;

  v_err := null; begin perform public.save_voyage_estimate(v_member, v_payload || jsonb_build_object('vesselId', (select id from public.vessels limit 1))); exception when others then v_err := sqlerrm; end;
  if exists (select 1 from public.vessels) and (v_err is null or v_err not like 'VOYAGE_FORBIDDEN:%') then raise exception 'S11: a member referenced a vessel they do not manage (%)', v_err; end if;

  v_err := null; begin perform public.save_voyage_estimate(v_member, v_payload || jsonb_build_object('ownerOrgId', gen_random_uuid())); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'VOYAGE_FORBIDDEN:%' then raise exception 'S11: an estimate was bound to an organisation without a seat (%)', v_err; end if;

  v_err := null; begin update public.voyage_estimate_runs set label = 'edited' where id = v_run; exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'VOYAGE_IMMUTABLE:%' then raise exception 'S11: a saved run was updated (%)', v_err; end if;
  v_err := null; begin delete from public.voyage_estimate_runs where id = v_run; exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'VOYAGE_IMMUTABLE:%' then raise exception 'S11: a saved run was deleted (%)', v_err; end if;
  v_err := null; begin delete from public.voyage_estimate_lines where run_id = v_run; exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'VOYAGE_IMMUTABLE:%' then raise exception 'S11: a saved line was deleted (%)', v_err; end if;
  if has_table_privilege('service_role', 'public.voyage_estimate_runs', 'DELETE') or has_table_privilege('service_role', 'public.voyage_estimate_runs', 'UPDATE')
     or has_table_privilege('service_role', 'public.voyage_estimate_lines', 'DELETE') or not has_table_privilege('service_role', 'public.voyage_estimate_runs', 'SELECT') then
    raise exception 'S11: service-role grants on saved runs are not read-only (writes go through save_voyage_estimate)';
  end if;

  -- Deleting the user anonymises the run; the economics stay. The S9 admin (published a version, wrote events) goes too.
  delete from public.users where id = v_member;
  select count(*) into n from public.voyage_estimate_runs where id = v_run and actor_user_id is null;
  if n <> 1 then raise exception 'S11: user deletion did not anonymise the run (found %)', n; end if;
  select id into v_s9 from public.users where full_name = 'smoke admin S9 (rolled back)';
  select count(*) into n from public.suez_tariff_events where actor_user_id = v_s9;
  if n = 0 then raise exception 'S11: the S9 admin has no events to anonymise'; end if;
  delete from public.users where id = v_s9;
  if exists (select 1 from public.suez_tariff_events where actor_user_id = v_s9)
     or exists (select 1 from public.suez_tariff_versions where created_by = v_s9 or published_by = v_s9) then
    raise exception 'S11: deleting the admin left references to it (events or versions)';
  end if;
  raise notice 'S11 ok: runs immutable, statused lines, object/owner checks, service role read-only, anonymised on user deletion';
end $$;

-- ── S12 · 205400: ECA geometry versions are append-only ─────────────────────
do $$
declare v_code text; v_err text;
begin
  perform set_config('asb.actor_user_id', '', true); -- S9's admin was deleted in S11; no actor carries over
  select code into v_code from public.eca_zones order by code limit 1;
  if v_code is null then raise notice 'S12 skipped: no ECA zone'; return; end if;
  if not exists (select 1 from public.eca_zone_versions v join public.eca_zones z on z.code = v.code and z.geometry_version = v.geometry_version where z.code = v_code) then
    raise exception 'S12: the current geometry of % has no version row', v_code;
  end if;
  v_err := null; begin update public.eca_zones set polygon = polygon || '[[0,0]]'::jsonb where code = v_code; exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'ECA_IMMUTABLE:%' then raise exception 'S12: geometry changed under an existing version id (%)', v_err; end if;
  v_err := null; begin delete from public.eca_zones where code = v_code; exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'ECA_IMMUTABLE:%' then raise exception 'S12: an ECA zone was deleted (%)', v_err; end if;
  v_err := null; begin update public.eca_zone_versions set name = 'edited' where code = v_code; exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'ECA_IMMUTABLE:%' then raise exception 'S12: a geometry version was edited (%)', v_err; end if;
  update public.eca_zones set geometry_version = geometry_version || '-s12', polygon = polygon || '[[0,0]]'::jsonb where code = v_code;
  if (select count(*) from public.eca_zone_versions where code = v_code) < 2 then raise exception 'S12: a new geometry did not append a version'; end if;
  raise notice 'S12 ok: geometry versions append-only; a new geometry appends, an old one never changes';
end $$;

-- ── S13 · 205500: reported only for surcharges, acting-admin attribution, durable origin, run guards, ECA facts ─
do $$
declare
  v_a uuid; v_b uuid; v_id uuid; r jsonb; v_err text; n int; v_actor uuid; v_pt jsonb; v_split jsonb; v_pair record;
begin
  perform set_config('asb.actor_user_id', '', true);
  insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s13a@arabshipbroker.test') returning id into v_a;
  insert into public.users (id, supabase_user_id, role, full_name, is_active) values (v_a, v_a, 'admin', 'smoke S13 publisher', true)
    on conflict (id) do update set supabase_user_id = excluded.supabase_user_id, role = excluded.role, full_name = excluded.full_name, is_active = true;
  insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s13b@arabshipbroker.test') returning id into v_b;
  insert into public.users (id, supabase_user_id, role, full_name, is_active) values (v_b, v_b, 'admin', 'smoke S13 withdrawer', true)
    on conflict (id) do update set supabase_user_id = excluded.supabase_user_id, role = excluded.role, full_name = excluded.full_name, is_active = true;

  r := public.admin_suez_create_version(v_a, jsonb_build_object('effectiveFrom', '2020-09-01', 'effectiveTo', '2020-09-30', 'sourceRef', 'smoke S13 (rolled back)'), null);
  v_id := (r ->> 'id')::uuid;
  v_err := null;
  begin perform public.admin_suez_save_item(v_id, v_a, null, '{"code":"smoke_rep","labelEn":"Smoke reported fixed","layer":"fixed","basis":"flat","currency":"USD","confidence":"reported","params":{"amount":1}}'::jsonb);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'S13: a reported confidence was accepted on a fixed item'; end if;
  perform public.admin_suez_save_item(v_id, v_a, null, '{"code":"smoke_flat","labelEn":"Smoke flat","layer":"fixed","basis":"flat","currency":"USD","params":{"amount":1}}'::jsonb);
  perform public.admin_suez_register_source(v_a, jsonb_build_object('title','Smoke S13 instrument','issuer','Suez Canal Authority','authority','official','evidenceStatus','on_file','sha256',repeat('b',64)), v_id);
  perform public.admin_suez_publish(v_id, v_a, 'PUBLISH');
  perform public.admin_suez_set_window(v_id, v_b, date '2020-09-30', 'smoke note');
  perform public.admin_suez_set_status(v_id, v_b, 'withdrawn');
  select actor_user_id into v_actor from public.suez_tariff_events where version_id = v_id and action = 'withdrawn';
  if v_actor is distinct from v_b then raise exception 'S13: the withdrawal is attributed to % instead of the acting admin', v_actor; end if;
  select actor_user_id into v_actor from public.suez_tariff_events where version_id = v_id and action = 'published';
  if v_actor is distinct from v_a then raise exception 'S13: the publication is not attributed to the publisher'; end if;
  if not exists (select 1 from public.suez_tariff_events where version_id = v_id and action = 'notes_changed' and actor_user_id = v_b) then
    raise exception 'S13: a notes change left no event';
  end if;
  if exists (select 1 from public.suez_tariff_events where version_id = v_id and origin <> 'command') then
    raise exception 'S13: an admin command event is not marked origin=command';
  end if;
  delete from public.users where id = v_a;
  if exists (select 1 from public.suez_tariff_events where version_id = v_id and origin <> 'command') then
    raise exception 'S13: anonymising the actor changed the event origin';
  end if;

  v_err := null;
  begin perform public.save_voyage_estimate(v_b, jsonb_build_object('algorithmVersion', 'voyage-engine/2', 'settingsHash', repeat('c', 64), 'input', '{}'::jsonb, 'result', '{}'::jsonb, 'totals', '{}'::jsonb,
    'availabilityId', (select id from public.vessel_availability limit 1)));
  exception when others then v_err := sqlerrm; end;
  if exists (select 1 from public.vessel_availability) and (v_err is null or v_err not like 'VOYAGE_INVALID:%without its vessel%') then
    raise exception 'S13: a position was linked without its vessel (%)', v_err;
  end if;
  if has_table_privilege('service_role', 'public.voyage_estimate_runs', 'INSERT') or has_table_privilege('service_role', 'public.voyage_estimate_lines', 'INSERT') then
    raise exception 'S13: the service role can insert runs/lines directly';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'voyage_estimate_lines' and column_name = 'status' and is_nullable = 'YES') then
    raise exception 'S13: line status is still nullable';
  end if;

  -- governed ECA facts: the route split reports its end zones; the settings anchorage is a point lookup
  select pol_locode a, pod_locode b into v_pair from public.port_routes limit 1;
  if found then
    v_split := public.fn_route_eca_split(v_pair.a, v_pair.b, current_date);
    if v_split ->> 'algorithmVersion' <> 'fn_route_eca_split/3' or not (v_split ? 'verified') then raise exception 'S13: split v3 shape missing (%)', v_split; end if;
  end if;
  select value -> 'suez' -> 'anchorages' -> 'SB' into v_pt from public.app_settings where key = 'voyage_settings';
  if v_pt is null then raise exception 'S13: the settings carry no Suez anchorage point'; end if;
  if public.fn_point_eca_zones((v_pt ->> 0)::numeric, (v_pt ->> 1)::numeric, current_date) is null then raise exception 'S13: anchorage lookup failed'; end if;
  -- dual-key regression: public.users.id ≠ supabase_user_id; the claim is keyed by the Auth id
  declare v_x uuid; v_y uuid; v_vessel uuid;
  begin
    select id into v_vessel from public.vessels limit 1;
    if v_vessel is not null then
      insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s13x@arabshipbroker.test') returning id into v_x;
      insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s13y@arabshipbroker.test') returning id into v_y;
      insert into public.users (id, supabase_user_id, role, full_name, is_active) values (v_x, v_y, 'Broker', 'smoke S13 dual key', true)
        on conflict (id) do update set supabase_user_id = excluded.supabase_user_id, role = excluded.role, is_active = true;
      insert into public.vessel_claims (vessel_id, user_id) values (v_vessel, v_y);
      if not public.fn_voyage_may_reference(v_x, 'vessel', v_vessel) then raise exception 'S13: a claim keyed by the Auth id did not authorise the member'; end if;
      if public.fn_voyage_may_reference(v_y, 'vessel', v_vessel) then raise exception 'S13: an id that is not the member''s public id was authorised'; end if;
    end if;
  end;
  if (select confdeltype from pg_constraint where conname = 'vessel_economics_profile_events_vessel_id_fkey') <> 'n' then
    raise exception 'S13: deleting a vessel still cascades into the append-only profile events';
  end if;
  raise notice 'S13 ok: reported only on surcharges, acting-admin attribution, notes audited, durable origin, run guards, split v3 + anchorage lookup';
end $$;

-- In linked mode (one rolled-back harness transaction) the rows above stay until the final ROLLBACK; they are
-- smoke rows, not governed records, so the DOWN's used-state guard is told so for this transaction only.
-- ── S14 · 205600: governed escort/age facts, SQL-validated escort + contingent params, legacy origin, rollback evidence ─
do $$
declare v_a uuid; v_vessel uuid; v_id uuid; v_item uuid; r jsonb; v_err text; n int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s14@arabshipbroker.test') returning id into v_a;
  insert into public.users (id, supabase_user_id, role, full_name, is_active) values (v_a, v_a, 'admin', 'smoke S14 admin (rolled back)', true)
    on conflict (id) do update set role = 'admin', is_active = true;
  -- the profile carries the governed Suez facts (as an admin session)
  select id into v_vessel from public.vessels limit 1;
  if v_vessel is null then raise notice 'S14 profile part skipped: no vessels in this database';
  else
    perform set_config('request.jwt.claim.sub', v_a::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
    r := public.upsert_vessel_economics_profile(v_vessel, '{"scnt": 16070, "buildYear": 2012, "craneCount": 4, "craneSwlMt": 30, "beamFt": 105.5, "doubleBottom": true}'::jsonb);
    if (r ->> 'buildYear')::int <> 2012 or (r ->> 'craneCount')::int <> 4 or (r ->> 'beamFt')::numeric <> 105.5 or (r ->> 'doubleBottom')::boolean is not true then
      raise exception 'S14: the profile did not keep the governed Suez facts: %', r; end if;
    v_err := null;
    begin perform public.upsert_vessel_economics_profile(v_vessel, '{"beamFt": 5}'::jsonb); exception when others then v_err := sqlerrm; end;
    if v_err is null or v_err not like 'VE_INVALID%' then raise exception 'S14: an impossible beam was accepted (%)', v_err; end if;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
  end if;
  -- escort and contingent params are validated by the database
  r := public.admin_suez_create_version(v_a, jsonb_build_object('effectiveFrom', '2020-10-01', 'effectiveTo', '2020-10-31', 'sourceRef', 'smoke S14 (rolled back)'), null);
  v_id := (r ->> 'id')::uuid;
  perform public.admin_suez_save_item(v_id, v_a, null, '{"code":"smoke_flat","labelEn":"Smoke flat","layer":"fixed","basis":"flat","currency":"USD","params":{"amount":1}}'::jsonb);
  perform public.admin_suez_register_source(v_a, jsonb_build_object('title','Smoke S14 instrument','issuer','Suez Canal Authority','authority','official','evidenceStatus','on_file','sha256',repeat('c',64)), v_id);
  perform public.admin_suez_save_item(v_id, v_a, null, '{"code":"smoke_escort","labelEn":"Smoke escort","layer":"conditional","basis":"flag_only","currency":"USD","conditionKey":"escort_tugs","params":{"rules":[{"status":"laden","scntMin":90000,"tugs":9}]}}'::jsonb);
  v_err := null; begin perform public.fn_suez_validate_version(v_id); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%malformed escort rule%' then raise exception 'S14: nine escort tugs passed validation (%)', v_err; end if;
  select id into v_item from public.suez_tariff_items where version_id = v_id and code = 'smoke_escort';
  perform public.admin_suez_save_item(v_id, v_a, v_item, '{"code":"smoke_escort","labelEn":"Smoke escort","layer":"conditional","basis":"flag_only","currency":"USD","conditionKey":"escort_tugs","params":{"rules":[{"status":"laden","scntMin":90000,"tugs":2,"secret":true}]}}'::jsonb);
  v_err := null; begin perform public.fn_suez_validate_version(v_id); exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'S14: an unknown key inside an escort rule passed validation'; end if;
  perform public.admin_suez_save_item(v_id, v_a, v_item, '{"code":"smoke_escort","labelEn":"Smoke escort","layer":"conditional","basis":"flag_only","currency":"USD","conditionKey":"escort_tugs","params":{"rules":[{"status":"laden","scntMin":90000,"tugs":2}]}}'::jsonb);
  perform public.fn_suez_validate_version(v_id);
  perform public.admin_suez_save_item(v_id, v_a, null, '{"code":"smoke_cont","labelEn":"Smoke contingent","layer":"conditional","basis":"flag_only","currency":"USD","conditionKey":"contingent","params":{"amount":-5}}'::jsonb);
  v_err := null; begin perform public.fn_suez_validate_version(v_id); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%contingent item%' then raise exception 'S14: a negative contingent amount passed validation (%)', v_err; end if;
  -- no admin action is labelled system: an actor-less event of a version a person created is a command
  select count(*) into n from public.suez_tariff_events e
   where e.origin = 'system' and e.actor_user_id is null and e.entity <> 'seed' and not (e.details ? 'migration')
     and exists (select 1 from public.suez_tariff_versions v where v.id = coalesce(e.version_id, e.entity_id) and v.created_by is not null);
  if n > 0 then raise exception 'S14: % admin event(s) still labelled system', n; end if;
  -- the rollback evidence table is outside the module and service-read-only
  if to_regclass('public.schema_rollback_evidence') is null then raise exception 'S14: schema_rollback_evidence is missing'; end if;
  if has_table_privilege('authenticated', 'public.schema_rollback_evidence', 'select') or has_table_privilege('service_role', 'public.schema_rollback_evidence', 'insert') then
    raise exception 'S14: the evidence table must be service read-only'; end if;
  raise notice 'S14 ok: profile carries build year, cranes, beam, double bottom (validated); escort and contingent params validated in SQL; no admin event labelled system; evidence table private';
end $$;

-- ── S15 · 205700: listing-key resolver and link facts authorise before they read ─
do $$
declare v_a uuid; v_m uuid; v_av uuid; v_key uuid; v_err text; r jsonb;
begin
  select id into v_av from public.vessel_availability order by created_at limit 1;
  if v_av is null then raise notice 'S15 skipped: no vessel positions in this database'; return; end if;
  insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s15-admin@arabshipbroker.test') returning id into v_a;
  insert into public.users (id, supabase_user_id, role, full_name, is_active) values (v_a, v_a, 'admin', 'smoke S15 admin (rolled back)', true)
    on conflict (id) do update set role = 'admin', is_active = true;
  insert into auth.users (id, email) values (gen_random_uuid(), 'smoke-s15-member@arabshipbroker.test') returning id into v_m;
  insert into public.users (id, supabase_user_id, role, full_name, is_active) values (v_m, v_m, 'vessel_owner', 'smoke S15 member (rolled back)', true)
    on conflict (id) do update set role = 'vessel_owner', is_active = true;
  -- the admin's own key resolves to the position
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  select h.key into v_key from public.fn_market_issue_handle(v_a, 'vessel_match', 'vessel_availability', v_av) h;
  if public.resolve_voyage_vessel_link(v_key) is distinct from v_av then raise exception 'S15: the admin''s own key must resolve to the position'; end if;
  if public.resolve_voyage_vessel_link(gen_random_uuid()) is not null then raise exception 'S15: an unknown key must resolve to null'; end if;
  r := public.voyage_link_facts(null, v_av);
  if (r -> 'position' ->> 'vesselId') is null then raise exception 'S15: the admin must read the linked position facts: %', r; end if;
  -- a member who does not own the position: its key resolves to null, its facts are refused before any read
  perform set_config('request.jwt.claim.sub', v_m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'member'))::text, true);
  select h.key into v_key from public.fn_market_issue_handle(v_m, 'vessel_match', 'vessel_availability', v_av) h;
  if public.resolve_voyage_vessel_link(v_key) is not null then raise exception 'S15: another member''s position must not resolve'; end if;
  v_err := null; begin r := public.voyage_link_facts(null, v_av); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'VOYAGE_FORBIDDEN%' then raise exception 'S15: a foreign position must be refused generically (%)', v_err; end if;
  if has_function_privilege('anon', 'public.voyage_link_facts(uuid, uuid)', 'execute') or has_function_privilege('anon', 'public.resolve_voyage_vessel_link(uuid)', 'execute') then
    raise exception 'S15: anonymous visitors must not reach the link functions'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'S15 ok: own key resolves, unknown/foreign keys resolve to null, foreign link facts refused before any read, anon excluded';
end $$;

select set_config('asb.stream_s_down', 'export-taken:smoke rows of this rolled-back transaction', true);

do $$ begin raise notice 'SUEZ GOVERNANCE SMOKE: ALL ASSERTIONS PASSED'; end $$;

rollback;
