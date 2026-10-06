-- Fixture Room · CANDIDATES body (C2O-011, 28 Sep 2026): list_fixture_match_candidates of
-- 20260923206000. Runs after the shared seed inside the caller's transaction. Adds one
-- grain cargo (c6, owned by the charterer organisation) that both the named vessel (a1)
-- and the TBN hull (a3) match, then proves ownership, masking and the match facts.

set local session_replication_role = replica;
insert into fx_ids (k, v) values ('c6', '00000000-0000-4000-8000-0000000000e6') on conflict do nothing;
insert into public.cargo_listings (id, ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo,
  qty_min_mt, qty_max_mt, stowage_factor, load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone,
  laycan_from, laycan_to, is_spot, load_rate, disch_rate, load_terms, freight_idea_usd_mt, commission_pct, demurrage_rate) values
  (pg_temp.fx_id('c6'), 'FXC-006', 'IN', 'APPROVED', 'Dry Bulk', 'Soya beans', false, true, 29000, 31000, 1.30,
   'ZZFXA', 'Fixture Load Port', 'E.MED', 'ZZFXB', 'Fixture Disch Port', 'E.MED', current_date + 10, current_date + 20, false,
   '8000', '6000', 'FIOST', 26.00, 2.5, 12000)
on conflict (id) do nothing;
insert into public.listing_ownership (listing_type, listing_id, owner_user_id, owner_org_id, role, is_current, transfer_reason) values
  ('cargo', pg_temp.fx_id('c6'), pg_temp.fx_id('u_ch1'), pg_temp.fx_id('org_ch'), 'primary', true, 'initial_post')
on conflict do nothing;
set local session_replication_role = origin;
select public.fn_refresh_matches();

do $$
declare v jsonb; c jsonb; s text; n int;
begin
  -- K1 · the owner of the cargo sees both hulls; the TBN one is a label with no identifier
  perform pg_temp.fx_as('u_ch1');
  v := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  s := v::text;
  select count(*) into n from jsonb_array_elements(v) x where x->>'name' in ('TBN', 'SEED VESSEL ONE') and x ? 'candidateKey';
  if n <> 2 then raise exception 'K1: both matching positions must be listed, got % in %', n, s; end if;
  select x into c from jsonb_array_elements(v) x where x->>'name' = 'TBN';
  if c->>'name' <> 'TBN' or (c->>'isTbn')::boolean is not true then raise exception 'K1: the TBN hull must be named TBN: %', c; end if;
  if s like '%SEED TBN HULL%' then raise exception 'K1: the TBN hull name reached the candidate payload'; end if;
  if s like '%' || pg_temp.fx_id('v3')::text || '%' or s like '%' || pg_temp.fx_id('v1')::text || '%' then
    raise exception 'K1: a vessels.id reached the candidate payload'; end if;
  if s like '%9000001%' then raise exception 'K1: an IMO number reached the candidate payload'; end if;
  if exists (select 1 from jsonb_array_elements(v) x where x ? 'vesselId' or x ? 'vesselRef' or x ? 'imo' or x ? 'availabilityId') then
    raise exception 'K1: a candidate carries a vessel identifier key'; end if;
  select x into c from jsonb_array_elements(v) x where x->>'name' = 'SEED VESSEL ONE';
  if c->>'name' <> 'SEED VESSEL ONE' then raise exception 'K1: a named vessel keeps its name: %', c; end if;
  raise notice 'K1 ok: the TBN hull is listed as TBN; no vessel id, IMO or hidden name in the payload';

  -- K2 · the match facts are the governed rule's: same zone, laycan window, grain certified
  if c->'fit'->>'zone' <> 'load' or c->'fit'->>'laycan' <> 'window' or (c->'fit'->>'grain')::boolean is not true then
    raise exception 'K2: the match facts must mirror the governed rule: %', c->'fit'; end if;
  raise notice 'K2 ok: each candidate carries the governed match facts (zone, laycan window, grain)';

  -- K3 · another member cannot list the matches of a listing they do not own
  perform pg_temp.fx_as('u_out');
  begin
    v := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
    raise exception 'K3: an outsider listed another member''s matches';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.fx_as('u_ow1');
  begin
    v := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
    raise exception 'K3: the counterparty listed the charterer''s matches';
  exception when insufficient_privilege then null;
  end;
  -- a second active seat of the owning organisation represents the listing too
  perform pg_temp.fx_as('u_ch2');
  v := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  if jsonb_array_length(v) < 2 then raise exception 'K3: an active seat of the owning organisation must see the matches'; end if;
  raise notice 'K3 ok: only the listing''s owner or its organisation''s active seats may list its matches';

  -- K4 · the vessel side follows the same ownership rule
  perform pg_temp.fx_as('u_ow1');
  v := public.list_fixture_match_candidates('vessel', pg_temp.fx_id('a3'));
  if not exists (select 1 from jsonb_array_elements(v) x where x->>'ref' = 'FXC-006') then
    raise exception 'K4: the TBN position must see the matching cargo: %', v; end if;
  perform pg_temp.fx_as('u_ch1');
  begin
    v := public.list_fixture_match_candidates('vessel', pg_temp.fx_id('a3'));
    raise exception 'K4: the charterer listed the owner''s position matches';
  exception when insufficient_privilege then null;
  end;
  raise notice 'K4 ok: the vessel side is governed by the same ownership rule';

  -- K5 · input validation and anonymous callers
  perform pg_temp.fx_as('u_ch1');
  begin
    v := public.list_fixture_match_candidates('fleet', pg_temp.fx_id('c6'));
    raise exception 'K5: an unknown kind was accepted';
  exception when invalid_parameter_value then null;
  end;
  perform pg_temp.fx_anon();
  begin
    v := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
    raise exception 'K5: an anonymous caller listed candidates';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.fx_owner();
  raise notice 'K5 ok: unknown kinds and anonymous callers are refused';

  -- K6 · a null kind is refused, not routed to the vessel branch (re-audit item 4)
  perform pg_temp.fx_as('u_ow1');
  begin
    v := public.list_fixture_match_candidates(null, pg_temp.fx_id('a3'));
    raise exception 'K6: a null kind was accepted';
  exception when invalid_parameter_value then null;
  end;
  perform pg_temp.fx_owner();
  raise notice 'K6 ok: a null kind is refused';

  -- K7 · the builder's own listings follow the create rule: an active second seat of the
  -- owning organisation sees the organisation's listing; an outsider sees none of it
  perform pg_temp.fx_as('u_ch2');
  v := public.list_fixture_my_listings();
  if not exists (select 1 from jsonb_array_elements(v->'cargo') x where x->>'id' = pg_temp.fx_id('c6')::text)
     or not exists (select 1 from jsonb_array_elements(v->'cargo') x where x->>'id' = pg_temp.fx_id('c1')::text) then
    raise exception 'K7: the second seat of the charterer organisation must see its cargo: %', v; end if;
  if v::text like '%' || pg_temp.fx_id('v1')::text || '%' or v::text like '%9000001%' then raise exception 'K7: an own-listing read carries a vessel id or IMO'; end if;
  perform pg_temp.fx_as('u_out');
  v := public.list_fixture_my_listings();
  if v::text like '%' || pg_temp.fx_id('c1')::text || '%' or v::text like '%' || pg_temp.fx_id('c6')::text || '%' then raise exception 'K7: an outsider sees another organisation''s listing: %', v; end if;
  perform pg_temp.fx_as('u_ow1');
  v := public.list_fixture_my_listings();
  if not exists (select 1 from jsonb_array_elements(v->'vessels') x where x->>'availabilityId' = pg_temp.fx_id('a3')::text and x->>'name' = 'SEED TBN HULL') then
    raise exception 'K7: the owner sees its own TBN position by name: %', v; end if;
  perform pg_temp.fx_owner();
  raise notice 'K7 ok: own listings follow the create rule (organisation seats included), with no vessel id or IMO';
end $$;
