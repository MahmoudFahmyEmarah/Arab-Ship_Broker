-- ════════════════════════════════════════════════════════════════════════
-- PDA · the Tariff Packs library and the pack record (the design's Ports module, owner B2ALL-061 "everything now")
--
-- A tariff belongs to the authority that issued it, not to a country: one PACK per published source document, with
-- every port whose tariff in force on the date cites it. Read through the member's own session (estimator gate),
-- published versions only. No internal id leaves the database: a pack is addressed by an opaque reference (the first
-- 16 hex of sha256 of its source id), and the record carries labels, figures and citations, never row ids.
--
--   fn_pda_tariff_pack_ref(source)       the opaque reference of a pack (private helper)
--   list_pda_tariff_packs(on)            member read: one card per pack, official documents first, then by size
--   get_pda_tariff_pack(ref, on)         member read: the pack's header, ports, charge lines and source document
-- Plain SQL. DOWN: supabase/rollback/20261019130000_pda_tariff_packs_down.sql (drops the three functions; no data).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create or replace function public.fn_pda_tariff_pack_ref(p_source_id uuid)
returns text language sql immutable set search_path to '' as $$
  select left(encode(extensions.digest(convert_to('pda-pack:' || p_source_id::text, 'UTF8'), 'sha256'), 'hex'), 16);
$$;
revoke all on function public.fn_pda_tariff_pack_ref(uuid) from public, anon, authenticated;

create or replace function public.list_pda_tariff_packs(p_on date default current_date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_result jsonb;
begin
  if public.fn_app_user_id() is null then raise exception 'PDA_AUTH: sign in required' using errcode = '42501'; end if;
  if not public.fn_pda_member_entitled() then raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501'; end if;
  if p_on is null then raise exception 'PDA_VALIDATION: a date is required' using errcode = '22023'; end if;

  with effective as (
    select distinct on (s.id)
      s.id as set_id, s.port_locode, s.terminal_id, v.id as version_id, v.edition_label, v.currency, v.effective_from, v.primary_source_id,
      (select count(*) from public.port_tariff_rules r where r.tariff_version_id = v.id) as rule_count
    from public.port_tariff_sets s
    join public.port_tariff_versions v on v.tariff_set_id = s.id and v.status = 'published'
    where s.is_active
      and v.effective_from <= p_on and (v.effective_to is null or v.effective_to >= p_on)
    order by s.id, v.effective_from desc, v.version_no desc
  ),
  packs as (
    select e.primary_source_id as source_id,
           array_agg(distinct e.currency) as currencies,
           min(e.effective_from) as effective_from,
           sum(e.rule_count)::int as lines,
           jsonb_agg(jsonb_build_object('locode', e.port_locode, 'name', p.trade_name, 'terminal', t.name, 'edition', e.edition_label, 'lines', e.rule_count)
                     order by p.trade_name, t.name nulls first) as ports
    from effective e
    join public.ports p on p.locode = e.port_locode
    left join public.port_terminals t on t.id = e.terminal_id
    group by e.primary_source_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'packRef', public.fn_pda_tariff_pack_ref(k.source_id),
           'authority', coalesce(pub.name, src.title),
           'publisherType', pub.publisher_type,
           'country', pub.country,
           'sourceTitle', src.title,
           'sourceAuthority', src.authority,
           'issueDate', src.issue_date,
           'currency', case when cardinality(k.currencies) = 1 then k.currencies[1] else 'mixed' end,
           'effectiveFrom', k.effective_from,
           'lines', k.lines,
           'ports', k.ports
         ) order by (src.authority = 'official') desc, k.lines desc, coalesce(pub.name, src.title)), '[]'::jsonb) into v_result
  from packs k
  join public.tariff_sources src on src.id = k.source_id
  left join public.tariff_publishers pub on pub.id = src.publisher_id;
  return v_result;
end $$;
revoke all on function public.list_pda_tariff_packs(date) from public, anon;
grant execute on function public.list_pda_tariff_packs(date) to authenticated, service_role;

create or replace function public.get_pda_tariff_pack(p_ref text, p_on date default current_date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_source uuid; v_result jsonb;
begin
  if public.fn_app_user_id() is null then raise exception 'PDA_AUTH: sign in required' using errcode = '42501'; end if;
  if not public.fn_pda_member_entitled() then raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501'; end if;
  if p_ref is null or p_ref !~ '^[0-9a-f]{16}$' or p_on is null then raise exception 'PDA_VALIDATION: unknown tariff pack' using errcode = '22023'; end if;

  -- only a source that the version in force for some active set cites can be opened (the same pick as the list)
  select e.primary_source_id into v_source
    from (select distinct on (s.id) v.primary_source_id
            from public.port_tariff_sets s
            join public.port_tariff_versions v on v.tariff_set_id = s.id and v.status = 'published'
           where s.is_active and v.effective_from <= p_on and (v.effective_to is null or v.effective_to >= p_on)
           order by s.id, v.effective_from desc, v.version_no desc) e
   where public.fn_pda_tariff_pack_ref(e.primary_source_id) = p_ref
   limit 1;
  if v_source is null then raise exception 'PDA_VALIDATION: unknown tariff pack' using errcode = '22023'; end if;

  with in_force as (
    select distinct on (s.id)
      s.id as set_id, s.port_locode, s.terminal_id, v.id as version_id, v.version_no, v.edition_label, v.currency, v.primary_source_id,
      v.effective_from, v.effective_to, v.published_at, v.rounding_mode, v.decimal_places, (v.supersedes_id is not null) as supersedes
    from public.port_tariff_sets s
    join public.port_tariff_versions v on v.tariff_set_id = s.id and v.status = 'published'
    where s.is_active and v.effective_from <= p_on and (v.effective_to is null or v.effective_to >= p_on)
    order by s.id, v.effective_from desc, v.version_no desc
  ),
  effective as (select * from in_force where primary_source_id = v_source)
  select jsonb_build_object(
    'packRef', p_ref,
    'authority', coalesce(pub.name, src.title),
    'publisherType', pub.publisher_type,
    'country', pub.country,
    'website', pub.website,
    'source', jsonb_build_object('title', src.title, 'authority', src.authority, 'issueDate', src.issue_date, 'effectiveFrom', src.effective_from,
                                 'effectiveTo', src.effective_to, 'language', src.language, 'registeredAt', src.registered_at,
                                 'currentness', src.currentness_note),
    'editions', (select coalesce(jsonb_agg(jsonb_build_object(
        'port', e.port_locode, 'portName', p.trade_name, 'terminal', t.name, 'edition', e.edition_label, 'version', e.version_no,
        'currency', e.currency, 'effectiveFrom', e.effective_from, 'effectiveTo', e.effective_to, 'publishedAt', e.published_at,
        'rounding', e.rounding_mode, 'decimals', e.decimal_places, 'supersedes', e.supersedes,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object(
            'code', r.code, 'label', r.label, 'basis', r.basis, 'amount', r.amount, 'rate', r.rate, 'unit', r.unit,
            'minimum', r.minimum_amount, 'maximum', r.maximum_amount, 'taxPercent', r.tax_percent, 'includedUnits', r.included_units,
            'services', coalesce(r.applicability->'requestedServices', '[]'::jsonb), 'page', r.source_page, 'sheet', r.source_sheet,
            'excerpt', r.source_excerpt, 'manual', r.basis = 'manual_quote'
          ) order by r.priority nulls last, r.code), '[]'::jsonb)
          from public.port_tariff_rules r where r.tariff_version_id = e.version_id)
      ) order by p.trade_name, t.name nulls first), '[]'::jsonb)
      from effective e join public.ports p on p.locode = e.port_locode left join public.port_terminals t on t.id = e.terminal_id)
  ) into v_result
  from public.tariff_sources src left join public.tariff_publishers pub on pub.id = src.publisher_id
  where src.id = v_source;
  return v_result;
end $$;
revoke all on function public.get_pda_tariff_pack(text, date) from public, anon;
grant execute on function public.get_pda_tariff_pack(text, date) to authenticated, service_role;
