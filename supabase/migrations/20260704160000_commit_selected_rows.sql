-- Selective commit: commit_sync_batch gains an optional p_row_ids filter so the
-- admin can sync only the staged rows they've reviewed/accepted (checkbox
-- selection in Review), not the whole sheet. p_row_ids null = commit all
-- committable rows (existing behaviour). Everything else is unchanged from the
-- sheet-ordered, dangling-port-safe, null-skipping version.

drop function if exists public.commit_sync_batch(uuid, text);

create or replace function public.commit_sync_batch(
  p_batch_id uuid, p_sheet text default null, p_row_ids uuid[] default null
) returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare
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
begin
  if not exists (select 1 from public.sync_batch where id = p_batch_id) then
    raise exception 'sync batch % not found', p_batch_id;
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

    insert into public.sync_commit_audit
      (batch_id, staged_row_id, table_name, key_column, business_key, op, before, after)
    values
      (p_batch_id, r.id, v_tbl, v_keycol, r.business_key, v_op, v_before, v_after);

    update public.sync_staged_row set committed = true where id = r.id;

    if v_op = 'insert' then v_inserted := v_inserted + 1;
    else v_updated := v_updated + 1;
    end if;
  end loop;

  update public.sync_batch
    set status = case
          when exists (
            select 1 from public.sync_staged_row
            where batch_id = p_batch_id and committed = false
              and classification in ('new','updated')
          ) then 'draft' else 'committed' end,
        committed_at = coalesce(committed_at, now())
  where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
exception when others then
  update public.sync_batch set status = 'failed', error = SQLERRM where id = p_batch_id;
  raise;
end;
$function$;

revoke all on function public.commit_sync_batch(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.commit_sync_batch(uuid, text, uuid[]) to service_role;
