-- PDA Estimator: maker/checker publication commands and immutability.
-- These RPCs are service-role only and are called after requireAdmin() in
-- server actions. They validate the canonical public.users actor again.

create or replace function public.fn_pda_assert_admin_actor(p_actor uuid)
returns void
language plpgsql stable security definer set search_path to ''
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.users u
    where u.id = p_actor and u.is_active and lower(coalesce(u.role, '')) = 'admin'
      and coalesce(u.admin_tier::text, 'super') = 'super'
  ) then
    raise exception 'PDA_AUTH: active admin actor required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.fn_pda_assert_admin_actor(uuid) from public, anon, authenticated;

create or replace function public.fn_pda_version_child_mutable()
returns trigger
language plpgsql set search_path to ''
as $$
declare
  v_version_id uuid;
  v_status text;
begin
  v_version_id := case when tg_table_name = 'port_tariff_bands' then (
    select r.tariff_version_id from public.port_tariff_rules r where r.id = coalesce(new.rule_id, old.rule_id)
  ) else coalesce(new.tariff_version_id, old.tariff_version_id) end;
  select status into v_status from public.port_tariff_versions where id = v_version_id;
  if v_status <> 'draft' then
    raise exception 'PDA_IMMUTABLE: submitted or published tariff children cannot change' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.fn_pda_version_child_mutable() from public, anon, authenticated;

drop trigger if exists trg_pda_rules_mutable on public.port_tariff_rules;
create trigger trg_pda_rules_mutable
before insert or update or delete on public.port_tariff_rules
for each row execute function public.fn_pda_version_child_mutable();

drop trigger if exists trg_pda_bands_mutable on public.port_tariff_bands;
create trigger trg_pda_bands_mutable
before insert or update or delete on public.port_tariff_bands
for each row execute function public.fn_pda_version_child_mutable();

create or replace function public.fn_pda_version_immutable()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if tg_op = 'DELETE' and old.status in ('published','superseded','withdrawn') then
    raise exception 'PDA_IMMUTABLE: published tariff versions cannot be deleted' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.status in ('published','superseded','withdrawn') then
    if old.status = 'published' and new.status in ('superseded','withdrawn')
       and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
      return new;
    end if;
    raise exception 'PDA_IMMUTABLE: published tariff versions cannot be edited' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.fn_pda_version_immutable() from public, anon, authenticated;

drop trigger if exists trg_pda_version_immutable on public.port_tariff_versions;
create trigger trg_pda_version_immutable
before update or delete on public.port_tariff_versions
for each row execute function public.fn_pda_version_immutable();

create or replace function public.pda_register_tariff_source(p_actor uuid, p_source jsonb)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_existing uuid;
  v_id uuid;
  v_sha text := lower(trim(p_source->>'sha256'));
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  if v_sha is null or v_sha !~ '^[a-f0-9]{64}$' then
    raise exception 'PDA_INPUT: valid sha256 is required' using errcode = '22023';
  end if;
  select id into v_existing from public.tariff_sources where sha256 = v_sha;
  if v_existing is not null then return v_existing; end if;

  insert into public.tariff_sources (
    publisher_id, title, source_filename, mime_type, sha256, storage_path,
    source_uri, language, authority, issue_date, effective_from, effective_to,
    currentness_note, registered_by
  ) values (
    nullif(p_source->>'publisherId','')::uuid,
    trim(p_source->>'title'),
    trim(p_source->>'sourceFilename'),
    trim(p_source->>'mimeType'),
    v_sha,
    nullif(p_source->>'storagePath',''),
    nullif(p_source->>'sourceUri',''),
    nullif(p_source->>'language',''),
    coalesce(nullif(p_source->>'authority',''), 'unverified'),
    nullif(p_source->>'issueDate','')::date,
    nullif(p_source->>'effectiveFrom','')::date,
    nullif(p_source->>'effectiveTo','')::date,
    nullif(p_source->>'currentnessNote',''),
    p_actor
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pda_register_tariff_source(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pda_register_tariff_source(uuid, jsonb) to service_role;

create or replace function public.pda_create_tariff_draft(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_set_id uuid := nullif(p_payload->>'tariffSetId','')::uuid;
  v_version_id uuid;
  v_port text := upper(trim(p_payload->>'portLocode'));
  v_terminal uuid := nullif(p_payload->>'terminalId','')::uuid;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  if not exists (select 1 from public.ports p where p.locode = v_port and p.is_active and p.is_verified) then
    raise exception 'PDA_PORT: exact active verified port is required' using errcode = '22023';
  end if;
  if v_terminal is not null and not exists (
    select 1 from public.port_terminals t
    where t.id = v_terminal and t.port_locode = v_port and t.is_active and t.is_verified
  ) then
    raise exception 'PDA_TERMINAL: terminal must be verified under the exact port' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tariff_sources s where s.id = (p_payload->>'primarySourceId')::uuid) then
    raise exception 'PDA_SOURCE: registered source is required' using errcode = '22023';
  end if;

  if v_set_id is null then
    insert into public.port_tariff_sets (
      port_locode, terminal_id, publisher_id, name, scope, created_by
    ) values (
      v_port, v_terminal, (p_payload->>'publisherId')::uuid,
      trim(p_payload->>'name'), coalesce(nullif(p_payload->>'scope',''), 'port_call'), p_actor
    ) returning id into v_set_id;
  elsif not exists (
    select 1 from public.port_tariff_sets s
    where s.id = v_set_id and s.port_locode = v_port and s.terminal_id is not distinct from v_terminal
  ) then
    raise exception 'PDA_SET: tariff set does not match the exact port/terminal' using errcode = '22023';
  end if;

  insert into public.port_tariff_versions (
    tariff_set_id, version_no, currency, effective_from, effective_to,
    rounding_mode, decimal_places, primary_source_id, supersedes_id, notes, created_by
  ) values (
    v_set_id, (p_payload->>'versionNo')::integer, upper(trim(p_payload->>'currency')),
    (p_payload->>'effectiveFrom')::date, nullif(p_payload->>'effectiveTo','')::date,
    coalesce(nullif(p_payload->>'roundingMode',''), 'half_up'),
    coalesce((p_payload->>'decimalPlaces')::smallint, 2),
    (p_payload->>'primarySourceId')::uuid,
    nullif(p_payload->>'supersedesId','')::uuid,
    nullif(p_payload->>'notes',''), p_actor
  ) returning id into v_version_id;
  return v_version_id;
end;
$$;
revoke all on function public.pda_create_tariff_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pda_create_tariff_draft(uuid, jsonb) to service_role;

create or replace function public.pda_replace_tariff_rules(p_actor uuid, p_version_id uuid, p_rules jsonb)
returns integer
language plpgsql security definer set search_path to ''
as $$
declare
  v_status text;
  v_rule jsonb;
  v_band jsonb;
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
  return v_count;
end;
$$;
revoke all on function public.pda_replace_tariff_rules(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pda_replace_tariff_rules(uuid, uuid, jsonb) to service_role;

create or replace function public.pda_submit_tariff_version(p_actor uuid, p_version_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  update public.port_tariff_versions
  set status = 'in_review', submitted_by = p_actor, submitted_at = now()
  where id = p_version_id and status = 'draft' and created_by = p_actor;
  if not found then raise exception 'PDA_STATE: only the maker may submit a draft' using errcode = '55000'; end if;
  if not exists (select 1 from public.port_tariff_rules where tariff_version_id = p_version_id) then
    raise exception 'PDA_RULES: a tariff cannot be submitted without rules' using errcode = '55000';
  end if;
end;
$$;
revoke all on function public.pda_submit_tariff_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pda_submit_tariff_version(uuid, uuid) to service_role;

create or replace function public.pda_publish_tariff_version(p_actor uuid, p_version_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v public.port_tariff_versions%rowtype;
  v_source_authority text;
  v_overlap uuid;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  select * into v from public.port_tariff_versions where id = p_version_id for update;
  if not found then raise exception 'PDA_NOT_FOUND: tariff version not found' using errcode = 'P0002'; end if;
  if v.status <> 'in_review' then raise exception 'PDA_STATE: tariff must be in review' using errcode = '55000'; end if;
  if v.created_by = p_actor then raise exception 'PDA_CHECKER: maker cannot approve own tariff' using errcode = '42501'; end if;
  select authority into v_source_authority from public.tariff_sources where id = v.primary_source_id;
  if v_source_authority not in ('official','agent','statutory') then
    raise exception 'PDA_SOURCE: unverified/reference source cannot be published' using errcode = '55000';
  end if;
  if not exists (select 1 from public.port_tariff_rules where tariff_version_id = p_version_id) then
    raise exception 'PDA_RULES: tariff has no rules' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v.tariff_set_id::text, 0));
  select x.id into v_overlap
  from public.port_tariff_versions x
  where x.tariff_set_id = v.tariff_set_id and x.id <> v.id and x.status = 'published'
    and daterange(x.effective_from, coalesce(x.effective_to + 1, 'infinity'::date), '[)') &&
        daterange(v.effective_from, coalesce(v.effective_to + 1, 'infinity'::date), '[)')
  order by x.published_at desc limit 1;
  if v_overlap is not null and v.supersedes_id is distinct from v_overlap then
    raise exception 'PDA_OVERLAP: overlapping publication must explicitly supersede %', v_overlap using errcode = '23505';
  end if;
  if v_overlap is not null then
    update public.port_tariff_versions set status = 'superseded' where id = v_overlap;
  end if;
  update public.port_tariff_versions
  set status = 'published', approved_by = p_actor, approved_at = now(), published_at = now()
  where id = p_version_id;
end;
$$;
revoke all on function public.pda_publish_tariff_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pda_publish_tariff_version(uuid, uuid) to service_role;
