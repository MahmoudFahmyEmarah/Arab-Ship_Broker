-- Governed admin intake for future port authorities, agents and extracted
-- tariff rows. Extraction output is untrusted staging data; it cannot become
-- a published tariff without the maker/checker workflow in 20260923101000.

create or replace function public.pda_upsert_tariff_publisher(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_id uuid;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  if length(trim(p_payload->>'name')) < 2 then
    raise exception 'PDA_PUBLISHER: name is required' using errcode = '22023';
  end if;
  insert into public.tariff_publishers(name, publisher_type, country, website, created_by)
  values (
    trim(p_payload->>'name'), coalesce(nullif(p_payload->>'publisherType',''), 'other'),
    nullif(trim(p_payload->>'country'), ''), nullif(trim(p_payload->>'website'), ''), p_actor
  )
  on conflict (name, publisher_type) do update set
    country = coalesce(excluded.country, public.tariff_publishers.country),
    website = coalesce(excluded.website, public.tariff_publishers.website),
    is_active = true
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pda_upsert_tariff_publisher(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pda_upsert_tariff_publisher(uuid, jsonb) to service_role;

create or replace function public.pda_stage_tariff_import(
  p_actor uuid, p_source_id uuid, p_extractor text, p_rows jsonb, p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_batch uuid; v_row jsonb; v_no integer := 0;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  if not exists (select 1 from public.tariff_sources where id = p_source_id) then
    raise exception 'PDA_SOURCE: registered source is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'PDA_IMPORT: extracted rows are required' using errcode = '22023';
  end if;
  insert into public.tariff_import_batches(source_id, extractor, extractor_meta, started_by)
  values (p_source_id, nullif(trim(p_extractor), ''), coalesce(p_meta, '{}'::jsonb), p_actor)
  returning id into v_batch;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_no := v_no + 1;
    insert into public.tariff_staged_rules(
      batch_id, row_no, raw_text, normalized_proposal, source_page, source_sheet,
      confidence, port_locode, terminal_id, validation_errors
    ) values (
      v_batch, coalesce((v_row->>'rowNo')::integer, v_no), coalesce(v_row->>'rawText', ''),
      coalesce(v_row->'normalizedProposal', '{}'::jsonb), nullif(v_row->>'sourcePage',''),
      nullif(v_row->>'sourceSheet',''), nullif(v_row->>'confidence','')::numeric,
      nullif(upper(trim(v_row->>'portLocode')), ''), nullif(v_row->>'terminalId','')::uuid,
      coalesce(v_row->'validationErrors', '[]'::jsonb)
    );
  end loop;
  update public.tariff_import_batches
  set status = 'review', summary = jsonb_build_object('rows', v_no), completed_at = now()
  where id = v_batch;
  return v_batch;
end;
$$;
revoke all on function public.pda_stage_tariff_import(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.pda_stage_tariff_import(uuid, uuid, text, jsonb, jsonb) to service_role;

create or replace function public.pda_decide_staged_rule(
  p_actor uuid, p_rule_id uuid, p_decision text, p_note text default null
)
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  if p_decision not in ('accepted','rejected','needs_mapping') then
    raise exception 'PDA_DECISION: invalid staging decision' using errcode = '22023';
  end if;
  update public.tariff_staged_rules set
    decision = p_decision, decided_by = p_actor, decided_at = now(), decision_note = nullif(trim(p_note),'')
  where id = p_rule_id and decision = 'pending';
  if not found then
    raise exception 'PDA_STATE: staged rule is missing or already decided' using errcode = '55000';
  end if;
end;
$$;
revoke all on function public.pda_decide_staged_rule(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.pda_decide_staged_rule(uuid, uuid, text, text) to service_role;

comment on function public.pda_stage_tariff_import(uuid, uuid, text, jsonb, jsonb) is
  'Stages untrusted PDF/spreadsheet extraction only. It deliberately has no publication side effect.';
