-- PDA Estimator: published calculation context and immutable estimate snapshots.

create table if not exists public.pda_estimates (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null references public.users(id) on delete restrict,
  owner_org_id        uuid references public.organizations(id) on delete restrict,
  port_locode         text not null references public.ports(locode) on delete restrict,
  terminal_id         uuid references public.port_terminals(id) on delete restrict,
  terminal_name       text,
  tariff_version_id   uuid references public.port_tariff_versions(id) on delete restrict,
  vessel_id           uuid references public.vessels(id) on delete restrict,
  call_date           date not null,
  coverage            text not null check (coverage in ('published','partial','manual_required')),
  input_snapshot      jsonb not null,
  fx_snapshot         jsonb not null default '{}'::jsonb,
  warnings            jsonb not null default '[]'::jsonb,
  native_currency     text not null,
  native_total        numeric(18,6) not null,
  converted_currency  text,
  converted_total     numeric(18,6),
  supersedes_id       uuid references public.pda_estimates(id) on delete restrict,
  generated_at        timestamptz not null,
  created_at          timestamptz not null default now(),
  constraint pda_estimates_currency_ck check (
    native_currency ~ '^[A-Z]{3}$' and
    (converted_currency is null or converted_currency ~ '^[A-Z]{3}$')
  ),
  constraint pda_estimates_totals_ck check (
    native_total >= 0 and (converted_total is null or converted_total >= 0)
  ),
  constraint pda_estimates_json_ck check (
    jsonb_typeof(input_snapshot) = 'object' and jsonb_typeof(fx_snapshot) = 'object' and jsonb_typeof(warnings) = 'array'
  ),
  constraint pda_estimates_conversion_ck check ((converted_currency is null) = (converted_total is null)),
  constraint pda_estimates_version_ck check (coverage = 'manual_required' or tariff_version_id is not null)
);

create table if not exists public.pda_estimate_lines (
  id                uuid primary key default gen_random_uuid(),
  estimate_id       uuid not null references public.pda_estimates(id) on delete cascade,
  line_no           integer not null,
  tariff_rule_id    uuid references public.port_tariff_rules(id) on delete restrict,
  source_id         uuid references public.tariff_sources(id) on delete restrict,
  rule_code         text,
  label             text not null,
  basis             text not null,
  quantity          numeric(18,6),
  rate              numeric(18,6),
  amount            numeric(18,6) not null,
  converted_amount  numeric(18,6),
  explanation       text not null,
  inputs            jsonb not null default '{}'::jsonb,
  evidence          jsonb not null default '{}'::jsonb,
  is_manual         boolean not null default false,
  manual_reason     text,
  entered_by_label  text,
  created_at        timestamptz not null default now(),
  constraint pda_estimate_lines_no_ck check (line_no > 0),
  constraint pda_estimate_lines_amount_ck check (amount >= 0 and (converted_amount is null or converted_amount >= 0)),
  constraint pda_estimate_lines_json_ck check (jsonb_typeof(inputs) = 'object' and jsonb_typeof(evidence) = 'object'),
  constraint pda_estimate_lines_basis_ck check (basis in (
    'flat','per_call','per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa',
    'per_cargo_mt','per_unit','percentage','tiered_flat','tiered_rate','progressive','manual_quote','manual'
  )),
  constraint pda_estimate_lines_evidence_ck check (
    is_manual or (tariff_rule_id is not null and source_id is not null)
  ),
  constraint pda_estimate_lines_manual_ck check (
    (not is_manual and manual_reason is null) or (is_manual and length(trim(manual_reason)) >= 3 and entered_by_label is not null)
  ),
  unique (estimate_id, line_no)
);

create index if not exists pda_estimates_owner_idx on public.pda_estimates (owner_user_id, generated_at desc);
create index if not exists pda_estimates_org_idx on public.pda_estimates (owner_org_id, generated_at desc) where owner_org_id is not null;
create index if not exists pda_estimates_port_idx on public.pda_estimates (port_locode, generated_at desc);
create index if not exists pda_estimates_version_idx on public.pda_estimates (tariff_version_id) where tariff_version_id is not null;
create index if not exists pda_estimate_lines_estimate_idx on public.pda_estimate_lines (estimate_id, line_no);

alter table public.pda_estimates enable row level security;
alter table public.pda_estimate_lines enable row level security;
revoke all on table public.pda_estimates, public.pda_estimate_lines from public, anon, authenticated;
grant all on table public.pda_estimates, public.pda_estimate_lines to service_role;

create or replace function public.fn_pda_snapshot_immutable()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  raise exception 'PDA_IMMUTABLE: estimate snapshots and lines cannot change' using errcode = '55000';
end;
$$;
revoke all on function public.fn_pda_snapshot_immutable() from public, anon, authenticated;

drop trigger if exists trg_pda_estimates_immutable on public.pda_estimates;
create trigger trg_pda_estimates_immutable
before update or delete on public.pda_estimates
for each row execute function public.fn_pda_snapshot_immutable();

drop trigger if exists trg_pda_estimate_lines_immutable on public.pda_estimate_lines;
create trigger trg_pda_estimate_lines_immutable
before update or delete on public.pda_estimate_lines
for each row execute function public.fn_pda_snapshot_immutable();

create or replace function public.fn_pda_member_entitled()
returns boolean
language sql stable security definer set search_path to ''
as $$
  select public.fn_is_admin() or exists (
    select 1 from public.users u
    where u.id = public.fn_app_user_id()
      and u.is_active
      and (
        u.subscription_tier::text in ('T3','T4')
        or coalesce((to_jsonb(u)->>'is_market_partner')::boolean, false)
      )
  );
$$;
revoke all on function public.fn_pda_member_entitled() from public, anon, authenticated;

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

create or replace function public.list_pda_coverage(p_call_date date default current_date)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_result jsonb;
begin
  if public.fn_app_user_id() is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'portLocode', x.port_locode,
    'portName', x.port_name,
    'terminalId', x.terminal_id,
    'terminalName', x.terminal_name,
    'tariffVersionId', x.version_id,
    'currency', x.currency,
    'effectiveFrom', x.effective_from,
    'effectiveTo', x.effective_to
  ) order by x.port_name, x.terminal_name nulls first), '[]'::jsonb) into v_result
  from (
    select distinct on (s.port_locode, s.terminal_id)
      s.port_locode, p.trade_name as port_name, s.terminal_id, t.name as terminal_name,
      v.id as version_id, v.currency, v.effective_from, v.effective_to
    from public.port_tariff_sets s
    join public.ports p on p.locode = s.port_locode and p.is_active and p.is_verified
    left join public.port_terminals t on t.id = s.terminal_id and t.is_active and t.is_verified
    join public.port_tariff_versions v on v.tariff_set_id = s.id and v.status = 'published'
    where s.is_active and v.effective_from <= p_call_date and (v.effective_to is null or v.effective_to >= p_call_date)
    order by s.port_locode, s.terminal_id, v.effective_from desc, v.version_no desc
  ) x;
  return v_result;
end;
$$;
revoke all on function public.list_pda_coverage(date) from public, anon;
grant execute on function public.list_pda_coverage(date) to authenticated, service_role;

create or replace function public.list_pda_terminals(p_port_locode text default null)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_result jsonb;
begin
  if public.fn_app_user_id() is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'portLocode', t.port_locode, 'name', t.name
  ) order by t.port_locode, t.name), '[]'::jsonb) into v_result
  from public.port_terminals t
  join public.ports p on p.locode = t.port_locode and p.is_active and p.is_verified
  where t.is_active and t.is_verified
    and (p_port_locode is null or t.port_locode = upper(trim(p_port_locode)));
  return v_result;
end;
$$;
revoke all on function public.list_pda_terminals(text) from public, anon;
grant execute on function public.list_pda_terminals(text) to authenticated, service_role;

create or replace function public.pda_save_estimate(
  p_actor uuid,
  p_owner_org_id uuid,
  p_request jsonb,
  p_result jsonb,
  p_supersedes_id uuid default null
)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_id uuid;
  v_version uuid := nullif(p_result->>'tariffVersionId','')::uuid;
  v_port text := upper(trim(p_request->>'portLocode'));
  v_terminal uuid := nullif(p_request->>'terminalId','')::uuid;
  v_coverage text := p_result->>'coverage';
  v_line jsonb;
  v_sum numeric;
  v_converted_sum numeric;
  v_total numeric := (p_result#>>'{totals,native}')::numeric;
  v_no integer := 0;
begin
  if not exists (select 1 from public.users where id = p_actor and is_active) then
    raise exception 'PDA_AUTH: active app user actor required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = p_actor and u.is_active
      and (
        lower(coalesce(u.role, '')) = 'admin'
        or u.subscription_tier::text in ('T3','T4')
        or coalesce((to_jsonb(u)->>'is_market_partner')::boolean, false)
      )
  ) then
    raise exception 'PDA_TIER: actor requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  if p_owner_org_id is not null and not exists (
    select 1 from public.organization_members m
    where m.org_id = p_owner_org_id and m.user_id = p_actor and m.is_current and m.status = 'active'
  ) and not exists (select 1 from public.users where id = p_actor and lower(coalesce(role,'')) = 'admin') then
    raise exception 'PDA_AUTH: actor is not a current member of owner organization' using errcode = '42501';
  end if;
  if v_coverage not in ('published','partial','manual_required') then
    raise exception 'PDA_INPUT: invalid coverage' using errcode = '22023';
  end if;
  if v_terminal is not null and not exists (
    select 1 from public.port_terminals t
    where t.id = v_terminal and t.port_locode = v_port and t.is_active and t.is_verified
  ) then
    raise exception 'PDA_TERMINAL: terminal does not belong to the exact port or is not verified' using errcode = '22023';
  end if;
  if jsonb_typeof(p_result->'lines') <> 'array' or jsonb_typeof(p_result->'warnings') <> 'array' then
    raise exception 'PDA_INPUT: result lines/warnings must be arrays' using errcode = '22023';
  end if;
  if v_coverage = 'published' and jsonb_array_length(p_result->'lines') = 0 then
    raise exception 'PDA_COVERAGE: zero-line estimates cannot be published coverage' using errcode = '22023';
  end if;
  select coalesce(sum((x->>'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_result->'lines') x;
  if abs(v_sum - v_total) > 0.000001 then
    raise exception 'PDA_TOTAL: native total does not equal line sum' using errcode = '22023';
  end if;
  select coalesce(sum(nullif(x->>'convertedAmount','')::numeric), 0)
  into v_converted_sum from jsonb_array_elements(p_result->'lines') x;
  if nullif(p_result#>>'{totals,converted}','') is not null
     and abs(v_converted_sum - (p_result#>>'{totals,converted}')::numeric) > 0.000001 then
    raise exception 'PDA_TOTAL: converted total does not equal converted line sum' using errcode = '22023';
  end if;
  if v_version is not null and not exists (
    select 1
    from public.port_tariff_versions v join public.port_tariff_sets s on s.id = v.tariff_set_id
    where v.id = v_version and v.status in ('published','superseded') and s.port_locode = v_port
      and (s.terminal_id is null or s.terminal_id = v_terminal)
      and v.effective_from <= (p_request->>'callDate')::date
      and (v.effective_to is null or v.effective_to >= (p_request->>'callDate')::date)
  ) then
    raise exception 'PDA_VERSION: result version does not cover the exact request' using errcode = '22023';
  end if;
  if v_coverage <> 'manual_required' and v_version is null then
    raise exception 'PDA_VERSION: published/partial result requires a tariff version' using errcode = '22023';
  end if;

  insert into public.pda_estimates (
    owner_user_id, owner_org_id, port_locode, terminal_id, terminal_name,
    tariff_version_id, vessel_id, call_date, coverage, input_snapshot, fx_snapshot,
    warnings, native_currency, native_total, converted_currency, converted_total,
    supersedes_id, generated_at
  ) values (
    p_actor, p_owner_org_id, v_port, v_terminal,
    (select t.name from public.port_terminals t where t.id = v_terminal),
    v_version, nullif(p_request#>>'{vessel,vesselId}','')::uuid,
    (p_request->>'callDate')::date, v_coverage, p_request,
    jsonb_build_object('currency', p_request->>'convertedCurrency', 'rate', p_request->'fxRate', 'source', 'member'),
    p_result->'warnings', upper(p_result->>'nativeCurrency'), v_total,
    nullif(upper(p_result->>'convertedCurrency'),''), nullif(p_result#>>'{totals,converted}','')::numeric,
    p_supersedes_id, coalesce(nullif(p_result->>'generatedAt','')::timestamptz, now())
  ) returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_result->'lines') loop
    v_no := v_no + 1;
    if nullif(v_line->>'ruleId','') is not null and not exists (
      select 1 from public.port_tariff_rules r
      where r.id = (v_line->>'ruleId')::uuid
        and r.tariff_version_id = v_version
        and r.source_id = nullif(v_line#>>'{evidence,sourceId}','')::uuid
    ) then
      raise exception 'PDA_LINE: rule and source evidence must belong to the saved tariff version' using errcode = '22023';
    end if;
    insert into public.pda_estimate_lines (
      estimate_id, line_no, tariff_rule_id, source_id, rule_code, label, basis,
      quantity, rate, amount, converted_amount, explanation, inputs, evidence,
      is_manual, manual_reason, entered_by_label
    ) values (
      v_id, v_no, nullif(v_line->>'ruleId','')::uuid,
      nullif(v_line#>>'{evidence,sourceId}','')::uuid, nullif(v_line->>'ruleCode',''),
      v_line->>'label', v_line->>'basis', nullif(v_line->>'quantity','')::numeric,
      nullif(v_line->>'rate','')::numeric, (v_line->>'amount')::numeric,
      nullif(v_line->>'convertedAmount','')::numeric, v_line->>'explanation',
      coalesce(v_line->'inputs','{}'::jsonb), coalesce(v_line->'evidence','{}'::jsonb),
      coalesce((v_line->>'manual')::boolean, false), nullif(v_line->>'manualReason',''),
      nullif(v_line->>'enteredBy','')
    );
  end loop;
  return v_id;
end;
$$;
revoke all on function public.pda_save_estimate(uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.pda_save_estimate(uuid, uuid, jsonb, jsonb, uuid) to service_role;

create or replace function public.fn_can_read_pda_estimate(p_estimate_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select public.fn_is_admin() or exists (
    select 1 from public.pda_estimates e
    where e.id = p_estimate_id and (
      e.owner_user_id = public.fn_app_user_id()
      or (e.owner_org_id is not null and exists (
        select 1 from public.organization_members m
        where m.org_id = e.owner_org_id and m.user_id = public.fn_app_user_id()
          and m.is_current and m.status = 'active'
      ))
    )
  );
$$;
revoke all on function public.fn_can_read_pda_estimate(uuid) from public, anon, authenticated;

create or replace function public.get_pda_estimate(p_estimate_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_result jsonb;
begin
  if not public.fn_can_read_pda_estimate(p_estimate_id) then
    raise exception 'PDA_AUTH: estimate is not accessible' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', e.id, 'portLocode', e.port_locode, 'terminalId', e.terminal_id,
    'terminalName', e.terminal_name, 'tariffVersionId', e.tariff_version_id,
    'coverage', e.coverage, 'input', e.input_snapshot, 'fx', e.fx_snapshot,
    'warnings', e.warnings, 'nativeCurrency', e.native_currency,
    'nativeTotal', e.native_total, 'convertedCurrency', e.converted_currency,
    'convertedTotal', e.converted_total, 'generatedAt', e.generated_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'lineNo', l.line_no, 'ruleId', l.tariff_rule_id, 'ruleCode', l.rule_code,
      'label', l.label, 'basis', l.basis, 'quantity', l.quantity, 'rate', l.rate,
      'amount', l.amount, 'convertedAmount', l.converted_amount,
      'explanation', l.explanation, 'inputs', l.inputs, 'evidence', l.evidence,
      'manual', l.is_manual, 'manualReason', l.manual_reason, 'enteredBy', l.entered_by_label
    ) order by l.line_no) from public.pda_estimate_lines l where l.estimate_id = e.id), '[]'::jsonb)
  ) into v_result from public.pda_estimates e where e.id = p_estimate_id;
  return v_result;
end;
$$;
revoke all on function public.get_pda_estimate(uuid) from public, anon;
grant execute on function public.get_pda_estimate(uuid) to authenticated, service_role;

create or replace function public.fn_pda_estimate_header(p_estimate_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_result jsonb;
begin
  if not public.fn_can_read_pda_estimate(p_estimate_id) then
    raise exception 'PDA_AUTH: estimate is not accessible' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', e.id,
    'portLocode', e.port_locode,
    'terminalId', e.terminal_id,
    'terminalName', e.terminal_name,
    'tariffVersionId', e.tariff_version_id,
    'coverage', e.coverage,
    'callDate', e.call_date,
    'vesselId', e.vessel_id,
    'nativeCurrency', e.native_currency,
    'nativeTotal', e.native_total,
    'convertedCurrency', e.converted_currency,
    'convertedTotal', e.converted_total,
    'fxRate', nullif(e.fx_snapshot->>'rate','')::numeric,
    'fxSource', e.fx_snapshot->>'source',
    'generatedAt', e.generated_at,
    'isSuperseded', exists (select 1 from public.pda_estimates n where n.supersedes_id = e.id),
    'lineCount', (select count(*) from public.pda_estimate_lines l where l.estimate_id = e.id),
    'manualLineCount', (select count(*) from public.pda_estimate_lines l where l.estimate_id = e.id and l.is_manual),
    'warningCount', jsonb_array_length(e.warnings)
  ) into v_result
  from public.pda_estimates e where e.id = p_estimate_id;
  return v_result;
end;
$$;
revoke all on function public.fn_pda_estimate_header(uuid) from public, anon, authenticated;

comment on function public.fn_can_read_pda_estimate(uuid) is 'Cross-module helper for governed server-side access checks. Deliberately has no direct member execute grant.';
comment on function public.fn_pda_estimate_header(uuid) is 'Minimal masked cross-module PDA snapshot. Deliberately has no direct member execute grant.';
