-- DOWN for 20261006300000_pda_compound_bases (PDA PR-10a). Refuses while any
-- rule or estimate line uses what the migration added. Run inside one transaction.

do $$
begin
  if exists (select 1 from public.port_tariff_rules
              where basis in ('per_gt_day','per_loa_day','per_loa_hour')
                 or duration_rounding <> 'exact' or unit_size <> 1
                 or applicability ? 'settlementModes')
     or exists (select 1 from public.pda_estimate_lines where basis in ('per_gt_day','per_loa_day','per_loa_hour')) then
    raise exception 'PDA_DOWN: PR-10a features are in use; export and remove those rules/estimates first';
  end if;
end $$;

create or replace function public.pda_replace_tariff_rules(p_actor uuid, p_version_id uuid, p_rules jsonb)
returns integer
language plpgsql security definer set search_path to ''
as $$
declare
  v_status text;
  v_rule jsonb;
  v_band jsonb;
  v_pair record;
  v_rule_id uuid;
  v_count integer := 0;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  select status into v_status from public.port_tariff_versions where id = p_version_id and created_by = p_actor for update;
  if v_status is null then raise exception 'PDA_NOT_FOUND: tariff version not found' using errcode = 'P0002'; end if;
  if v_status <> 'draft' then raise exception 'PDA_IMMUTABLE: submitted or published rules cannot change' using errcode = '55000'; end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then
    raise exception 'PDA_INPUT: at least one rule is required' using errcode = '22023';
  end if;

  delete from public.port_tariff_rules where tariff_version_id = p_version_id;
  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if jsonb_typeof(coalesce(v_rule->'applicability','{}'::jsonb)) <> 'object'
       or exists (select 1 from jsonb_object_keys(coalesce(v_rule->'applicability','{}'::jsonb)) k
         where k not in ('requestedServices','vesselTypes','cargoTypes','cargoStatuses','voyageScopes','locations',
           'minGt','maxGt','minNt','maxNt','minScnrt','maxScnrt','minDwt','maxDwt','minLoaM','maxLoaM',
           'minDraftM','maxDraftM','minCargoQuantityMt','maxCargoQuantityMt','percentageBaseCodes')) then
      raise exception 'PDA_APPLICABILITY: % has unsupported applicability fields', v_rule->>'code' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(coalesce(v_rule->'applicability','{}'::jsonb)) e
      where e.key in ('requestedServices','vesselTypes','cargoTypes','cargoStatuses','voyageScopes','locations','percentageBaseCodes')
        and (jsonb_typeof(e.value) <> 'array' or exists (select 1 from jsonb_array_elements(e.value) x where jsonb_typeof(x) <> 'string'))) then
      raise exception 'PDA_APPLICABILITY: % list fields must be string arrays', v_rule->>'code' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(coalesce(v_rule->'applicability','{}'::jsonb)) e
      where (e.key like 'min%' or e.key like 'max%') and jsonb_typeof(e.value) <> 'number') then
      raise exception 'PDA_APPLICABILITY: % ranges must be numeric', v_rule->>'code' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(coalesce(v_rule->'applicability','{}'::jsonb)) e
      where e.key in ('requestedServices','vesselTypes','cargoTypes','cargoStatuses','voyageScopes','locations','percentageBaseCodes')
        and (jsonb_array_length(e.value) > 100 or exists (
          select 1 from jsonb_array_elements_text(e.value) item(value)
          where length(trim(item.value)) not between 1 and 120
        ))) then
      raise exception 'PDA_APPLICABILITY: % list fields contain too many or invalid values', v_rule->>'code' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements_text(coalesce(v_rule#>'{applicability,cargoStatuses}','[]'::jsonb)) item(value) where item.value not in ('laden','ballast'))
       or exists (select 1 from jsonb_array_elements_text(coalesce(v_rule#>'{applicability,voyageScopes}','[]'::jsonb)) item(value) where item.value not in ('domestic','international'))
       or exists (select 1 from jsonb_array_elements_text(coalesce(v_rule#>'{applicability,locations}','[]'::jsonb)) item(value) where item.value not in ('alongside','anchorage'))
       or exists (select 1 from jsonb_array_elements_text(coalesce(v_rule#>'{applicability,percentageBaseCodes}','[]'::jsonb)) item(value) where item.value !~ '^[a-z][a-z0-9_]{1,79}$') then
      raise exception 'PDA_APPLICABILITY: % contains an unsupported enumerated value or rule code', v_rule->>'code' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(coalesce(v_rule->'applicability','{}'::jsonb)) e
      where (e.key like 'min%' or e.key like 'max%') and (e.value #>> '{}')::numeric < 0) then
      raise exception 'PDA_APPLICABILITY: % ranges cannot be negative', v_rule->>'code' using errcode = '22023';
    end if;
    for v_pair in select * from (values
      ('minGt','maxGt'), ('minNt','maxNt'), ('minScnrt','maxScnrt'), ('minDwt','maxDwt'),
      ('minLoaM','maxLoaM'), ('minDraftM','maxDraftM'), ('minCargoQuantityMt','maxCargoQuantityMt')
    ) as pairs(min_key, max_key) loop
      if (v_rule->'applicability') ? v_pair.min_key and (v_rule->'applicability') ? v_pair.max_key
         and (v_rule#>>array['applicability',v_pair.min_key])::numeric > (v_rule#>>array['applicability',v_pair.max_key])::numeric then
        raise exception 'PDA_APPLICABILITY: % has an inverted %/% range', v_rule->>'code', v_pair.min_key, v_pair.max_key using errcode = '22023';
      end if;
    end loop;
    if nullif(v_rule->>'unit','') is not null
       and (v_rule->>'unit') not in ('gt','nt','scnrt','dwt','loa_m','days','hours','units','cargo_mt') then
      raise exception 'PDA_UNIT: % has an unsupported unit', v_rule->>'code' using errcode = '22023';
    end if;
    if (v_rule->>'basis') in ('tiered_flat','tiered_rate','progressive')
       and nullif(v_rule->>'unit','') is null then
      raise exception 'PDA_UNIT: % requires a supported band unit', v_rule->>'code' using errcode = '22023';
    end if;
    if (v_rule->>'basis') = 'percentage'
       and jsonb_array_length(coalesce(v_rule#>'{applicability,percentageBaseCodes}','[]'::jsonb)) = 0 then
      raise exception 'PDA_PERCENTAGE: % requires at least one base code', v_rule->>'code' using errcode = '22023';
    end if;
    insert into public.port_tariff_rules (
      tariff_version_id, code, label, basis, amount, rate, unit, priority,
      included_units, minimum_amount, maximum_amount, tax_percent, applicability,
      manual_instructions, source_id, source_page, source_sheet, source_excerpt
    ) values (
      p_version_id, v_rule->>'code', v_rule->>'label', v_rule->>'basis',
      nullif(v_rule->>'amount','')::numeric, nullif(v_rule->>'rate','')::numeric,
      nullif(v_rule->>'unit',''), coalesce((v_rule->>'priority')::integer, 100),
      coalesce(nullif(v_rule->>'includedUnits','')::numeric, 0),
      nullif(v_rule->>'minimumAmount','')::numeric, nullif(v_rule->>'maximumAmount','')::numeric,
      nullif(v_rule->>'taxPercent','')::numeric, coalesce(v_rule->'applicability', '{}'::jsonb),
      nullif(v_rule->>'manualInstructions',''), (v_rule->>'sourceId')::uuid,
      nullif(v_rule->>'sourcePage',''), nullif(v_rule->>'sourceSheet',''), nullif(v_rule->>'sourceExcerpt','')
    ) returning id into v_rule_id;
    for v_band in select value from jsonb_array_elements(coalesce(v_rule->'bands', '[]'::jsonb)) loop
      insert into public.port_tariff_bands (
        rule_id, band_order, lower_bound, upper_bound, flat_amount, rate
      ) values (
        v_rule_id, (v_band->>'order')::integer, (v_band->>'lowerBound')::numeric,
        nullif(v_band->>'upperBound','')::numeric, nullif(v_band->>'flatAmount','')::numeric,
        nullif(v_band->>'rate','')::numeric
      );
    end loop;
    if (v_rule->>'basis') in ('tiered_flat','tiered_rate','progressive') then
      if not exists (select 1 from public.port_tariff_bands where rule_id = v_rule_id) then
        raise exception 'PDA_BANDS: % requires at least one band', v_rule->>'code' using errcode = '22023';
      end if;
      if exists (
        select 1 from (
          select band_order, lower_bound, upper_bound,
            lag(upper_bound) over (order by band_order) as prior_upper,
            row_number() over (order by band_order) as position,
            count(*) over () as band_count
          from public.port_tariff_bands where rule_id = v_rule_id
        ) b
        where (b.position = 1 and b.lower_bound <> 0)
           or (b.position > 1 and b.lower_bound is distinct from b.prior_upper)
           or (b.position < b.band_count and b.upper_bound is null)
           or (b.position = b.band_count and b.upper_bound is not null)
      ) then
        raise exception 'PDA_BANDS: % bands must start at zero, be contiguous and end open', v_rule->>'code' using errcode = '22023';
      end if;
      if (v_rule->>'basis') in ('tiered_rate','progressive') and exists (
        select 1 from public.port_tariff_bands where rule_id = v_rule_id and rate is null
      ) then
        raise exception 'PDA_BANDS: % requires a rate in every band', v_rule->>'code' using errcode = '22023';
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  if exists (
    select 1 from public.port_tariff_rules r
    cross join lateral jsonb_array_elements_text(coalesce(r.applicability->'percentageBaseCodes','[]'::jsonb)) base(code)
    left join public.port_tariff_rules prior on prior.tariff_version_id = r.tariff_version_id and prior.code = base.code
    where r.tariff_version_id = p_version_id and r.basis = 'percentage'
      and (prior.id is null or prior.priority >= r.priority)
  ) then
    raise exception 'PDA_PERCENTAGE: every base code must be a lower-priority rule in the same version' using errcode = '22023';
  end if;
  return v_count;
end;
$$;
revoke all on function public.pda_replace_tariff_rules(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pda_replace_tariff_rules(uuid, uuid, jsonb) to service_role;

create or replace function public.get_pda_calculation_context(
  p_port_locode text,
  p_terminal_id uuid,
  p_call_date date
)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_version public.port_tariff_versions%rowtype;
  v_set public.port_tariff_sets%rowtype;
  v_rules jsonb;
begin
  if public.fn_app_user_id() is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  if p_call_date is null then raise exception 'PDA_INPUT: call date is required' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.ports p
    where p.locode = upper(trim(p_port_locode)) and p.is_active and p.is_verified
  ) then
    raise exception 'PDA_PORT: exact active verified port is required' using errcode = '22023';
  end if;
  if p_terminal_id is not null and not exists (
    select 1 from public.port_terminals t
    where t.id = p_terminal_id and t.port_locode = upper(trim(p_port_locode)) and t.is_active and t.is_verified
  ) then
    raise exception 'PDA_TERMINAL: terminal does not belong to the exact port or is not verified' using errcode = '22023';
  end if;

  select v.* into v_version
  from public.port_tariff_versions v
  join public.port_tariff_sets s on s.id = v.tariff_set_id
  where s.port_locode = upper(trim(p_port_locode)) and s.is_active and v.status = 'published'
    and (s.terminal_id = p_terminal_id or s.terminal_id is null)
    and v.effective_from <= p_call_date and (v.effective_to is null or v.effective_to >= p_call_date)
  order by (s.terminal_id is not null) desc, v.effective_from desc, v.version_no desc
  limit 1;

  if v_version.id is null then
    return jsonb_build_object(
      'coverage', 'manual_required',
      'portLocode', upper(trim(p_port_locode)),
      'terminalId', p_terminal_id,
      'callDate', p_call_date,
      'tariffVersion', null,
      'warning', 'No published tariff covers this exact port/terminal/date.'
    );
  end if;

  select * into v_set from public.port_tariff_sets where id = v_version.tariff_set_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'label', r.label,
      'basis', r.basis,
      'amount', r.amount,
      'rate', r.rate,
      'unit', r.unit,
      'priority', r.priority,
      'includedUnits', r.included_units,
      'minimumAmount', r.minimum_amount,
      'maximumAmount', r.maximum_amount,
      'taxPercent', r.tax_percent,
      'applicability', r.applicability,
      'manualInstructions', r.manual_instructions,
      'bands', coalesce((
        select jsonb_agg(jsonb_build_object(
          'order', b.band_order,
          'lowerBound', b.lower_bound,
          'upperBound', b.upper_bound,
          'flatAmount', b.flat_amount,
          'rate', b.rate
        ) order by b.band_order)
        from public.port_tariff_bands b where b.rule_id = r.id
      ), '[]'::jsonb),
      'source', jsonb_build_object(
        'sourceId', src.id,
        'title', src.title,
        'page', r.source_page,
        'sheet', r.source_sheet,
        'excerpt', r.source_excerpt
      )
    ) order by r.priority, r.code
  ), '[]'::jsonb) into v_rules
  from public.port_tariff_rules r
  join public.tariff_sources src on src.id = r.source_id
  where r.tariff_version_id = v_version.id;

  return jsonb_build_object(
    'coverage', 'published',
    'tariffVersion', jsonb_build_object(
      'id', v_version.id,
      'tariffSetId', v_version.tariff_set_id,
      'portLocode', v_set.port_locode,
      'terminalId', v_set.terminal_id,
      'versionNo', v_version.version_no,
      'currency', v_version.currency,
      'effectiveFrom', v_version.effective_from,
      'effectiveTo', v_version.effective_to,
      'roundingMode', v_version.rounding_mode,
      'decimalPlaces', v_version.decimal_places,
      'rules', v_rules
    )
  );
end;
$$;
revoke all on function public.get_pda_calculation_context(text, uuid, date) from public, anon;
grant execute on function public.get_pda_calculation_context(text, uuid, date) to authenticated, service_role;

alter table public.pda_estimate_lines drop constraint if exists pda_estimate_lines_basis_ck;
alter table public.pda_estimate_lines add constraint pda_estimate_lines_basis_ck check (basis in (
    'flat','per_call','per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa',
    'per_cargo_mt','per_unit','percentage','tiered_flat','tiered_rate','progressive','manual_quote','manual'
  ));
alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_basis_value_ck;
alter table public.port_tariff_rules add constraint port_tariff_rules_basis_value_ck check (
    (basis in ('flat','per_call') and coalesce(amount, rate) is not null)
    or (basis in ('per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa','per_cargo_mt','per_unit','percentage') and rate is not null)
    or basis in ('tiered_flat','tiered_rate','progressive','manual_quote')
  );
alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_basis_check;
alter table public.port_tariff_rules add constraint port_tariff_rules_basis_check check (basis in (
    'flat','per_call','per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa',
    'per_cargo_mt','per_unit','percentage','tiered_flat','tiered_rate','progressive','manual_quote'
  ));
alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_rounding_ck;
alter table public.port_tariff_rules drop column if exists unit_size;
alter table public.port_tariff_rules drop column if exists duration_rounding;

delete from supabase_migrations.schema_migrations where version = '20261006300000';
