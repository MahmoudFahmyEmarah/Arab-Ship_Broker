-- ════════════════════════════════════════════════════════════════════════
-- Port identity: the gate + the Ports review queue (10 Sep 2026)
--
-- Owner's decision (10 Sep 2026): "block defects, queue the rest". Before
-- today only ONE rule in the whole set blocked anything (DQ-V04, forms only),
-- so a cargo could land with an unroutable port and nobody was stopped.
--
-- The line between a defect and broker language is now explicit, because
-- fn_resolve_port_side classifies every port field as port | options | area |
-- none. Only `none` is a defect — free text we cannot place at all. An area
-- ("Egypt Med") commits normally and feeds its nominated reference port.
--
--   DQ-P03  side is unclassified free text        → BLOCK  (sync, pipeline, forms, review)
--   DQ-P04  known area / list, no reference port  → warn, error in reports
--   DQ-R05  reframed: side is an area with a ref port → info (figures are estimates)
--   DQ-P02  name resolves but code missing        → warn (the trigger self-heals it)
--
-- Blocked names land in port_review_queue, the same shape as the commodity
-- and vessel queues that already work in Manual Review.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the Ports review queue ──────────────────────────────────────────────
create table if not exists public.port_review_queue (
  id             uuid primary key default gen_random_uuid(),
  raw_name       text not null,
  name_key       text not null,
  side           text not null check (side in ('load', 'disch', 'open')),
  sample_ref     text,
  source         text,
  first_batch_id text,
  hits           integer not null default 1,
  suggested_zone public.zone_enum,
  status         text not null default 'pending'
                 check (status in ('pending', 'mapped', 'ignored')),
  resolved_kind  text check (resolved_kind in ('port', 'alias', 'area')),
  mapped_locode  text references public.ports(locode) on update cascade,
  mapped_area_key text references public.port_areas(area_key) on update cascade,
  resolved_by    uuid,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (name_key, side)
);
comment on table public.port_review_queue is
  'Port text the resolver cannot place as a port, a list of ports or a known area. Cleared in Data Sync → Manual Review → Ports.';

alter table public.port_review_queue enable row level security;
do $rls$
begin
  drop policy if exists "port_review_queue: admin all" on public.port_review_queue;
  create policy "port_review_queue: admin all" on public.port_review_queue for all to authenticated
    using (public.fn_is_admin()) with check (public.fn_is_admin());
end $rls$;
grant select on public.port_review_queue to authenticated;
grant all    on public.port_review_queue to service_role;

-- Sweep: find every unclassified port side, live or staged, and queue it.
-- Idempotent — re-running only bumps the hit counts.
create or replace function public.fn_port_review_sweep()
 returns integer language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n integer := 0;
begin
  with sides as (
    select 'load'::text side, c.load_port_name nm, c.ref, c.batch_id, c.load_zone zone, 'cargo_listings'::text src
      from cargo_listings c
     where (fn_resolve_port_side(c.load_port_locode, c.load_port_name)->>'scope') = 'none'
    union all
    select 'disch', c.disch_port_name, c.ref, c.batch_id, c.disch_zone, 'cargo_listings'
      from cargo_listings c
     where (fn_resolve_port_side(c.disch_port_locode, c.disch_port_name)->>'scope') = 'none'
    union all
    select 'load', s.payload->>'load_port_name', s.payload->>'ref', s.batch_id::text, null::zone_enum, 'sync_staged_row'
      from sync_staged_row s
     where not s.committed and s.sheet ilike '%cargo%'
       and (fn_resolve_port_side(s.payload->>'load_port_locode', s.payload->>'load_port_name')->>'scope') = 'none'
    union all
    select 'disch', s.payload->>'disch_port_name', s.payload->>'ref', s.batch_id::text, null::zone_enum, 'sync_staged_row'
      from sync_staged_row s
     where not s.committed and s.sheet ilike '%cargo%'
       and (fn_resolve_port_side(s.payload->>'disch_port_locode', s.payload->>'disch_port_name')->>'scope') = 'none'
  ), agg as (
    select fn_port_key(fn_port_strip_notation(coalesce(nm, ''))) k, side,
           min(coalesce(nm, '(empty)')) nm, count(*) n,
           min(ref) ref, min(batch_id) batch_id, min(src) src,
           (array_agg(zone) filter (where zone is not null))[1] zone
      from sides group by 1, 2
  )
  insert into public.port_review_queue (raw_name, name_key, side, sample_ref, source, first_batch_id, hits, suggested_zone)
  select a.nm, coalesce(a.k, '(empty)'), a.side, a.ref, a.src, a.batch_id, a.n, a.zone
    from agg a
  on conflict (name_key, side) do update
    set hits = excluded.hits,
        sample_ref = coalesce(public.port_review_queue.sample_ref, excluded.sample_ref);
  get diagnostics v_n = row_count;
  return v_n;
end $function$;
comment on function public.fn_port_review_sweep() is
  'Queues every unclassified port side (live listings + uncommitted staged rows) for Manual Review.';

-- Resolve one queue row: either map the text to an existing port (an alias),
-- or declare it an area with a nominated reference port. Re-classifies the
-- listings that used the text.
create or replace function public.resolve_port_review(
  p_id          uuid,
  p_kind        text,                  -- 'alias' | 'area' | 'ignore'
  p_locode      text default null,     -- alias target, or an area's reference port
  p_area_name   text default null,
  p_area_kind   text default 'area',
  p_zone        text default null,
  p_candidates  text[] default '{}'::text[]
) returns jsonb language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  q        port_review_queue%rowtype;
  v_area   text;
  v_touched integer := 0;
begin
  if not fn_is_admin() then
    raise exception 'Only an administrator can resolve a port review.';
  end if;
  select * into q from port_review_queue where id = p_id;
  if not found then
    raise exception 'Port review row not found.';
  end if;

  if p_kind = 'ignore' then
    update port_review_queue
       set status = 'ignored', resolved_by = auth.uid(), resolved_at = now()
     where id = p_id;
    return jsonb_build_object('ok', true, 'action', 'ignored');
  end if;

  if p_kind = 'alias' then
    if p_locode is null or not exists (select 1 from ports where locode = p_locode) then
      raise exception 'Pick an existing port for an alias.';
    end if;
    insert into port_aliases (alias_key, alias_text, locode, note, created_by)
    values (q.name_key, q.raw_name, p_locode, 'From Manual Review → Ports', auth.uid())
    on conflict (alias_key) do update set locode = excluded.locode, alias_text = excluded.alias_text;
    update port_review_queue
       set status = 'mapped', resolved_kind = 'alias', mapped_locode = p_locode,
           resolved_by = auth.uid(), resolved_at = now()
     where id = p_id;

  elsif p_kind = 'area' then
    v_area := q.name_key;
    if p_locode is not null and not exists (select 1 from ports where locode = p_locode) then
      raise exception 'The reference port must exist in the registry.';
    end if;
    insert into port_areas (area_key, area_name, kind, zone, ref_locode, candidate_locodes, note, created_by)
    values (v_area, coalesce(p_area_name, q.raw_name), coalesce(p_area_kind, 'area'),
            nullif(p_zone, '')::zone_enum, p_locode,
            coalesce((select array_agg(c order by c) from unnest(p_candidates) c
                       where exists (select 1 from ports p where p.locode = c)), '{}'::text[]),
            'From Manual Review → Ports', auth.uid())
    on conflict (area_key) do update
      set ref_locode = coalesce(excluded.ref_locode, port_areas.ref_locode),
          zone       = coalesce(excluded.zone, port_areas.zone),
          candidate_locodes = case when cardinality(excluded.candidate_locodes) > 0
                                   then excluded.candidate_locodes else port_areas.candidate_locodes end;
    update port_review_queue
       set status = 'mapped', resolved_kind = 'area', mapped_area_key = v_area,
           resolved_by = auth.uid(), resolved_at = now()
     where id = p_id;
  else
    raise exception 'Unknown resolution kind: %', p_kind;
  end if;

  -- Re-classify the listings that used this text (the trigger recomputes when
  -- the scope is nulled).
  if q.side = 'load' then
    update cargo_listings set load_port_scope = null
     where fn_port_key(fn_port_strip_notation(coalesce(load_port_name, ''))) = q.name_key;
  else
    update cargo_listings set disch_port_scope = null
     where fn_port_key(fn_port_strip_notation(coalesce(disch_port_name, ''))) = q.name_key;
  end if;
  get diagnostics v_touched = row_count;

  return jsonb_build_object('ok', true, 'action', p_kind, 'listings_reclassified', v_touched);
end $function$;
grant execute on function public.resolve_port_review(uuid, text, text, text, text, text, text[]) to authenticated;
grant execute on function public.fn_port_review_sweep() to authenticated, service_role;

-- ── 2 · the rules ───────────────────────────────────────────────────────────
-- DQ-P03 · the only genuine defect: text we cannot place at all.
select public.fn_dq_seed_rule(
  'DQ-P03',
  'Port side is a port, a list of ports, or a known area',
  'validity', 'error', 'declarative', 'none', 'built-in',
  'Every port field must classify as a single port, a list of ports where at least one is a port, or a known area in port_areas. Anything else is free text nobody can route from, and it is refused on the way in and queued for Manual Review → Ports.',
  'fn_resolve_port_side(code, name) ->> scope <> ''none''',
  jsonb_build_array(
    jsonb_build_object(
      'table', 'cargo_listings', 'field', 'load_port_locode',
      'violation_sql', '(public.fn_resolve_port_side(r.load_port_locode, r.load_port_name)->>''scope'') = ''none''',
      'observed_sql',  'coalesce(''text: '' || nullif(btrim(coalesce(r.load_port_name, '''')), ''''), ''(no load port)'')',
      'expected_text', 'a port, a list of ports, or an area listed in port_areas',
      'message',       'the load side names something we cannot place — add it as a port alias or an area in Admin → Ports'),
    jsonb_build_object(
      'table', 'cargo_listings', 'field', 'disch_port_locode',
      'violation_sql', '(public.fn_resolve_port_side(r.disch_port_locode, r.disch_port_name)->>''scope'') = ''none''',
      'observed_sql',  'coalesce(''text: '' || nullif(btrim(coalesce(r.disch_port_name, '''')), ''''), ''(no discharge port)'')',
      'expected_text', 'a port, a list of ports, or an area listed in port_areas',
      'message',       'the discharge side names something we cannot place — add it as a port alias or an area in Admin → Ports'),
    jsonb_build_object(
      'table', 'vessel_availability', 'field', 'open_port_locode',
      'violation_sql', 'r.open_port_name is not null and btrim(r.open_port_name) <> '''' and (public.fn_resolve_port_side(r.open_port_locode, r.open_port_name)->>''scope'') = ''none''',
      'observed_sql',  '''text: '' || r.open_port_name',
      'expected_text', 'a port, a list of ports, or an area listed in port_areas',
      'message',       'the open position names something we cannot place')
  ),
  array['cargo_listings', 'vessel_availability']
);

-- DQ-P04 · a legitimate area, but no reference port has been nominated, so it
-- still cannot feed distance / Voy OPEX / Ports DA.
select public.fn_dq_seed_rule(
  'DQ-P04',
  'Area or option list carries a reference port',
  'completeness', 'error', 'declarative', 'none', 'built-in',
  'A side that names an area or a list of ports must resolve to a reference port, otherwise no distance, Voy OPEX or Ports DA can be produced. Nominate the port on the area in Admin → Ports.',
  'scope in (area, options) implies ref_locode is not null',
  jsonb_build_array(
    jsonb_build_object(
      'table', 'cargo_listings', 'field', 'load_ref_locode',
      'violation_sql', '(public.fn_resolve_port_side(r.load_port_locode, r.load_port_name)->>''scope'') in (''area'', ''options'') and (public.fn_resolve_port_side(r.load_port_locode, r.load_port_name)->>''ref_locode'') is null and coalesce(r.load_port_2_locode, '''') = ''''',
      'observed_sql',  '''no reference port for '' || coalesce(r.load_port_name, ''—'')',
      'expected_text', 'a nominated reference port on the area',
      'message',       'the load side is an area with no reference port — nominate one in Admin → Ports'),
    jsonb_build_object(
      'table', 'cargo_listings', 'field', 'disch_ref_locode',
      'violation_sql', '(public.fn_resolve_port_side(r.disch_port_locode, r.disch_port_name)->>''scope'') in (''area'', ''options'') and (public.fn_resolve_port_side(r.disch_port_locode, r.disch_port_name)->>''ref_locode'') is null and coalesce(r.disch_port_2_locode, '''') = ''''',
      'observed_sql',  '''no reference port for '' || coalesce(r.disch_port_name, ''—'')',
      'expected_text', 'a nominated reference port on the area',
      'message',       'the discharge side is an area with no reference port — nominate one in Admin → Ports')
  ),
  array['cargo_listings']
);

-- DQ-R05 reframed: an area with a reference port is now a RECOGNISED shape,
-- and the information that matters is that its figures are estimates.
update public.dq_rules
   set name = 'Areas and ranges resolve to a reference port (figures are estimates)',
       description = 'A side that names an area, a country or a range keeps its text and draws its distance and costs from the area''s nominated reference port. Every such figure is labelled an estimate. This rule counts them so the owner can see how much of the market is estimated rather than fixed.',
       definition = 'info: scope in (area, options) with a reference port',
       severity = 'info',
       checks = jsonb_build_array(
         jsonb_build_object(
           'table', 'cargo_listings', 'field', 'load_port_name',
           'violation_sql', '(public.fn_resolve_port_side(r.load_port_locode, r.load_port_name)->>''scope'') in (''area'', ''options'') and (public.fn_resolve_port_side(r.load_port_locode, r.load_port_name)->>''ref_locode'') is not null',
           'observed_sql',  'r.load_port_name || '' → est. from '' || (public.fn_resolve_port_side(r.load_port_locode, r.load_port_name)->>''ref_locode'')',
           'expected_text', 'a named port for a fixed figure',
           'message',       'the load side is an area — distance and costs are estimated from its reference port'),
         jsonb_build_object(
           'table', 'cargo_listings', 'field', 'disch_port_name',
           'violation_sql', '(public.fn_resolve_port_side(r.disch_port_locode, r.disch_port_name)->>''scope'') in (''area'', ''options'') and (public.fn_resolve_port_side(r.disch_port_locode, r.disch_port_name)->>''ref_locode'') is not null',
           'observed_sql',  'r.disch_port_name || '' → est. from '' || (public.fn_resolve_port_side(r.disch_port_locode, r.disch_port_name)->>''ref_locode'')',
           'expected_text', 'a named port for a fixed figure',
           'message',       'the discharge side is an area — distance and costs are estimated from its reference port')
       ),
       updated_at = now()
 where code = 'DQ-R05';

-- DQ-C05 now reads both sides, and accepts a reference port as routable.
update public.dq_rules
   set name = 'Live cargo can be routed on both sides',
       description = 'A cargo the members can see must resolve to a port on each side — its own LOCODE, or the reference port of the area it names. Otherwise the market card can show no distance, no Voy OPEX and no Ports DA.',
       checks = jsonb_build_array(
         jsonb_build_object(
           'table', 'cargo_listings', 'field', 'load_port_locode',
           'query_sql', 'select c.* from public.cargo_listings c where c.status in (''IN'', ''PARTIAL'') and c.review_status = ''APPROVED'' and coalesce(c.load_port_locode, c.load_ref_locode, c.load_port_2_locode) is null',
           'observed_sql', 'coalesce(''text: '' || r.load_port_name, ''—'')',
           'expected_sql', 'coalesce(public.fn_resolve_port_locode(r.load_port_name), ''a UN/LOCODE or a reference port'')',
           'fix_sql', 'public.fn_resolve_port_locode(r.load_port_name)',
           'fix_rationale', 'Registry name match through fn_resolve_port_locode.',
           'message', 'this live cargo has no routable load port'),
         jsonb_build_object(
           'table', 'cargo_listings', 'field', 'disch_port_locode',
           'query_sql', 'select c.* from public.cargo_listings c where c.status in (''IN'', ''PARTIAL'') and c.review_status = ''APPROVED'' and coalesce(c.disch_port_locode, c.disch_ref_locode, c.disch_port_2_locode) is null',
           'observed_sql', 'coalesce(''text: '' || r.disch_port_name, ''—'')',
           'expected_sql', 'coalesce(public.fn_resolve_port_locode(r.disch_port_name), ''a UN/LOCODE or a reference port'')',
           'fix_sql', 'public.fn_resolve_port_locode(r.disch_port_name)',
           'fix_rationale', 'Registry name match through fn_resolve_port_locode.',
           'message', 'this live cargo has no routable discharge port')
       ),
       updated_at = now()
 where code = 'DQ-C05';

-- ── 3 · channel modes ───────────────────────────────────────────────────────
-- DQ-P03 is the block. Everything else stays advisory so legitimate broker
-- language keeps flowing.
delete from public.dq_rule_channels
 where rule_id in (select id from public.dq_rules where code in ('DQ-P03', 'DQ-P04', 'DQ-C05', 'DQ-P02'));

insert into public.dq_rule_channels (rule_id, channel, mode)
select r.id, c.channel, c.mode
  from public.dq_rules r
  join (values
    ('DQ-P03', 'sync',     'block'),
    ('DQ-P03', 'pipeline', 'block'),
    ('DQ-P03', 'forms',    'block'),
    ('DQ-P03', 'review',   'block'),
    ('DQ-P03', 'api',      'block'),
    ('DQ-P04', 'sync',     'warn'),
    ('DQ-P04', 'pipeline', 'warn'),
    ('DQ-P04', 'review',   'warn'),
    ('DQ-P04', 'forms',    'warn'),
    ('DQ-C05', 'sync',     'warn'),
    ('DQ-C05', 'pipeline', 'warn'),
    ('DQ-P02', 'sync',     'warn'),
    ('DQ-P02', 'pipeline', 'warn'),
    ('DQ-P02', 'review',   'warn')
  ) as c(code, channel, mode) on c.code = r.code;

-- ── 4 · first sweep ─────────────────────────────────────────────────────────
select public.fn_port_review_sweep();
