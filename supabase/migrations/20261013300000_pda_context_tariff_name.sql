-- PDA · every tariff VERSION carries a frozen, member-facing edition label (C2O-120 correction of B2C-049)
--
-- Members must see which published edition priced a port (Codex C2O-090 P2: Egypt's "base rates (not escalated)").
-- The label belongs to the immutable VERSION, not to the mutable set name:
--   * port_tariff_versions.edition_label (1–400 characters, not null) is fixed when the version row is created:
--     "<set name at that moment> · v<version_no> (from <effective_from>)". Two versions of one set therefore never
--     share a label, and renaming the set later never relabels an existing version (the BEFORE INSERT trigger copies
--     the name once; published versions are already immutable through trg_pda_version_immutable).
--   * existing versions are backfilled explicitly with the same rule (the immutability trigger is paused for that one
--     UPDATE inside this transaction and re-enabled; the backfill sets only the new column).
--   * get_pda_calculation_context returns tariffVersion.editionLabel; the body is otherwise identical to 20261006300000
--     and its grants are unchanged (anon none; authenticated, service_role).
--   * set names are valid up to 300 characters (port_tariff_sets_name_ck), so the label fits in 400.
-- DOWN: supabase/rollback/20261013300000_pda_context_tariff_name_down.sql
set local lock_timeout = '5s';

alter table public.port_tariff_versions add column if not exists edition_label text;

create or replace function public.fn_pda_version_edition_label()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if new.edition_label is null or btrim(new.edition_label) = '' then
    new.edition_label := (select ts.name from public.port_tariff_sets ts where ts.id = new.tariff_set_id)
                         || ' · v' || new.version_no || ' (from ' || to_char(new.effective_from, 'YYYY-MM-DD') || ')';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_pda_version_edition_label() from public, anon, authenticated;

drop trigger if exists trg_pda_version_edition_label on public.port_tariff_versions;
create trigger trg_pda_version_edition_label
before insert on public.port_tariff_versions
for each row execute function public.fn_pda_version_edition_label();

-- explicit backfill of every existing version (published ones included), then the column becomes mandatory
alter table public.port_tariff_versions disable trigger trg_pda_version_immutable;
update public.port_tariff_versions v
   set edition_label = ts.name || ' · v' || v.version_no || ' (from ' || to_char(v.effective_from, 'YYYY-MM-DD') || ')'
  from public.port_tariff_sets ts
 where ts.id = v.tariff_set_id and v.edition_label is null;
alter table public.port_tariff_versions enable trigger trg_pda_version_immutable;

alter table public.port_tariff_versions alter column edition_label set not null;
alter table public.port_tariff_versions drop constraint if exists port_tariff_versions_edition_label_ck;
alter table public.port_tariff_versions add constraint port_tariff_versions_edition_label_ck
  check (char_length(btrim(edition_label)) between 1 and 400);
comment on column public.port_tariff_versions.edition_label is
  'Member-facing edition label, fixed when the version is created (set name · vN (from date)); never follows later set renames.';

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
      'editionLabel', v_version.edition_label,
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
