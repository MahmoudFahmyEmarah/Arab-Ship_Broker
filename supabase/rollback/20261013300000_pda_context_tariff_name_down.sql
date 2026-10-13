-- DOWN for 20261013300000_pda_context_tariff_name: restores get_pda_calculation_context exactly as 20261006300000 defined it.
set local lock_timeout = '5s';

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
      'rounding', r.duration_rounding,
      'unitSize', r.unit_size,
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
