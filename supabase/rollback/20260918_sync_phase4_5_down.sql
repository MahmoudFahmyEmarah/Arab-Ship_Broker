-- DOWN for 20260918140000_sync_phase4_fidelity.sql and 20260918150000_sync_phase5_scale.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_phase4_5_down.sql
--   supabase migration repair --status reverted 20260918140000 20260918150000
-- Deploy the pre-phase-4 application first (it no longer calls fn_sync_previous_payloads).
-- commit_sync_batch's phase-3 body (20260918130000) is restored below, verbatim.

-- phase 5: only the indexes 20260918150000 itself created (never every idx_trgm_% — Data Quality has its own)
drop index if exists public.idx_trgm_cargo_listings_ref;
drop index if exists public.idx_trgm_cargo_listings_commodity_name;
drop index if exists public.idx_trgm_cargo_listings_load_port_name;
drop index if exists public.idx_trgm_cargo_listings_disch_port_name;
drop index if exists public.idx_trgm_cargo_listings_broker;
drop index if exists public.idx_trgm_ports_locode;
drop index if exists public.idx_trgm_ports_trade_name;
drop index if exists public.idx_trgm_ports_country;
drop index if exists public.idx_trgm_vessels_imo_number;
drop index if exists public.idx_trgm_vessels_vessel_name;
drop index if exists public.idx_trgm_vessels_flag;
drop index if exists public.idx_trgm_vessels_owner_company;
drop index if exists public.idx_trgm_flag_states_name;
drop index if exists public.idx_trgm_flag_states_iso2;
drop index if exists public.idx_trgm_flag_states_category;
drop index if exists public.idx_trgm_organizations_name;
drop index if exists public.idx_trgm_organizations_country;
drop index if exists public.idx_trgm_organizations_desk_email;
drop index if exists public.idx_trgm_commodities_canonical_name;
drop index if exists public.idx_trgm_commodities_category_label;
drop index if exists public.idx_trgm_market_names_market_name;
drop index if exists public.idx_trgm_market_names_code;
drop index if exists public.idx_trgm_market_names_group_or_cat;
drop index if exists public.idx_trgm_grain_list_market_name;
drop index if exists public.idx_trgm_grain_list_family;
drop index if exists public.idx_trgm_imsbc_codes_bcsn;
drop index if exists public.idx_trgm_imsbc_codes_imsbc_group;
drop index if exists public.idx_trgm_imsbc_codes_un_number;
drop index if exists public.idx_trgm_sync_staged_row_business_key;
-- (pg_trgm itself is left installed: other objects may use it)

-- phase 4
drop function if exists public.fn_sync_unknown_ports(jsonb, text[]);
drop function if exists public.fn_sync_previous_payloads(text, text, text[]);
drop trigger if exists trg_staged_row_source_default on public.sync_staged_row;
drop function if exists public.fn_staged_row_source_default();
drop index if exists public.idx_staged_prev_by_source;
alter table public.sync_staged_row drop column if exists source;
-- the pre-phase-4 commit body, verbatim
create or replace function public.commit_sync_batch(
  p_batch_id uuid, p_sheet text default null, p_row_ids uuid[] default null
) returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  b          public.sync_batch%rowtype;
  r          record;
  v_tbl      text;
  v_keycol   text;
  v_before   jsonb;
  v_after    jsonb;
  v_cols     text;
  v_setclause text;
  v_op       text;
  v_inserted int := 0;
  v_updated  int := 0;
  v_skipped  int := 0;
  v_pc       text;
  v_portcols text[] := array['load_port_locode','disch_port_locode',
    'load_port_2_locode','load_port_3_locode','load_port_4_locode',
    'disch_port_2_locode','disch_port_3_locode','disch_port_4_locode'];
  v_batch_ports text[];
  v_remaining boolean;
  v_any_audit boolean;
  v_resting   text;
  v_stale     int;
  v_stale_why text;
begin
  select * into b from public.sync_batch where id = p_batch_id for update;
  if not found then
    raise exception 'sync batch % not found', p_batch_id;
  end if;
  if b.status = 'committed' then
    raise exception 'BATCH_STATE: this batch is already committed' using errcode = '55000';
  end if;
  if b.status = 'undone' then
    raise exception 'BATCH_STATE: an undone batch cannot be committed again — stage it afresh' using errcode = '55000';
  end if;
  if b.status = 'gate_failed' then
    raise exception 'BATCH_STATE: the data-quality gate did not run on this batch — run the gate first' using errcode = '55000';
  end if;
  if b.status = 'committing' then
    raise exception 'BATCH_STATE: another commit of this batch is in progress' using errcode = '55000';
  end if;
  v_resting := case when b.status = 'failed' then 'gated' else b.status end;

  -- phase 3: nothing is written unless the gate passed exactly this payload
  -- under the rules in force
  select count(*), string_agg(distinct reason, '; ')
    into v_stale, v_stale_why
    from public.fn_sync_gate_stale(p_batch_id, p_sheet, p_row_ids);
  if v_stale > 0 then
    raise exception 'GATE_STALE: % row(s) must pass the data-quality gate before they can be committed (%) — run the gate on this batch and try again', v_stale, v_stale_why
      using errcode = '55000';
  end if;

  update public.sync_batch set status = 'committing' where id = p_batch_id;

  select coalesce(array_agg(upper(payload->>'locode')) filter (where nullif(payload->>'locode','') is not null), '{}')
    into v_batch_ports
  from public.sync_staged_row where batch_id = p_batch_id and sheet = 'ports';

  for r in
    select * from public.sync_staged_row
    where batch_id = p_batch_id
      and (p_sheet is null or sheet = p_sheet)
      and (p_row_ids is null or id = any (p_row_ids))
      and committed = false
      and classification in ('new','updated')
    order by case sheet
               when 'ports' then 1 when 'commodities' then 2
               when 'companies' then 3 when 'vessels' then 4
               when 'cargo' then 5 else 6 end,
             row_index nulls last, created_at
  loop
    v_tbl    := r.target_table;
    v_keycol := r.key_column;

    if not fn_sync_table_allowed(v_tbl) then
      raise exception 'sync target table % is not permitted', v_tbl;
    end if;
    if v_keycol is distinct from fn_sync_key_column(v_tbl) then
      raise exception 'key column mismatch for %: staged=% expected=%',
        v_tbl, v_keycol, fn_sync_key_column(v_tbl);
    end if;

    if v_tbl = 'cargo_listings' then
      foreach v_pc in array v_portcols loop
        if (r.payload ? v_pc)
           and not exists (select 1 from public.ports p where upper(p.locode) = upper(r.payload ->> v_pc))
           and not (upper(r.payload ->> v_pc) = any (v_batch_ports)) then
          r.payload := r.payload - v_pc;
        end if;
      end loop;
    end if;

    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', v_tbl, v_keycol)
      into v_before using r.business_key;

    v_op := case when v_before is null then 'insert' else 'update' end;

    select string_agg(quote_ident(k), ', ') into v_cols
    from jsonb_object_keys(r.payload) k
    where jsonb_typeof(r.payload -> k) <> 'null';

    if v_cols is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_op = 'insert' then
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)
           on conflict (%I) do nothing
         returning to_jsonb(public.%I.*)',
        v_tbl, v_cols, v_cols, v_tbl, v_keycol, v_tbl
      ) into v_after using r.payload;
    else
      select string_agg(format('%I = s.%I', k, k), ', ') into v_setclause
      from jsonb_object_keys(r.payload) k
      where k <> v_keycol
        and jsonb_typeof(r.payload -> k) <> 'null';

      if v_setclause is null then
        v_after := v_before;
      else
        execute format(
          'update public.%I as t set %s
             from jsonb_populate_record(null::public.%I, $1) as s
            where t.%I::text = $2
           returning to_jsonb(t)',
          v_tbl, v_setclause, v_tbl, v_keycol
        ) into v_after using r.payload, r.business_key;
      end if;
    end if;

    if v_after is null then
      execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', v_tbl, v_keycol)
        into v_after using r.business_key;
    end if;

    if v_tbl in ('cargo_listings','vessel_availability') then
      execute format(
        'update public.%I set review_status = ''APPROVED'',
           goes_live_at = coalesce(goes_live_at, now())
         where %I::text = $1', v_tbl, v_keycol)
        using r.business_key;
      execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', v_tbl, v_keycol)
        into v_after using r.business_key;
    end if;

    insert into public.sync_commit_audit
      (batch_id, staged_row_id, table_name, key_column, business_key, op, before, after)
    values
      (p_batch_id, r.id, v_tbl, v_keycol, r.business_key, v_op, v_before, v_after);

    update public.sync_staged_row set committed = true where id = r.id;

    if v_op = 'insert' then v_inserted := v_inserted + 1;
    else v_updated := v_updated + 1;
    end if;
  end loop;

  v_remaining := exists (
    select 1 from public.sync_staged_row
    where batch_id = p_batch_id and committed = false and classification in ('new','updated'));
  v_any_audit := exists (
    select 1 from public.sync_commit_audit where batch_id = p_batch_id and undone_at is null);

  update public.sync_batch
    set status = case
          when not v_remaining then 'committed'
          when v_any_audit then 'partial'
          else v_resting end,
        committed_at = case when v_any_audit then coalesce(committed_at, now()) else committed_at end,
        error = null
  where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
exception when others then
  -- rolls back with the raise; the application records failure separately
  update public.sync_batch set status = 'failed', error = SQLERRM where id = p_batch_id;
  raise;
end;
$function$;
revoke all on function public.commit_sync_batch(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.commit_sync_batch(uuid, text, uuid[]) to service_role;
