-- Data quality gate on Data Sync (9 Sep 2026)
--
-- fn_dq_gate_batch checks every staged row of a batch against the DQ rules
-- on a channel ('sync' for workbook uploads, 'pipeline' for circulars and
-- WhatsApp). Each hit becomes a flag on the row ({level, field, msg, rule,
-- mode}); block-level hits make the row "invalid" so commit_sync_batch never
-- writes it, warn-level hits ride with the row into the Review tab. Block hits
-- are logged in dq_gate_log. Re-running is safe: previous gate flags are
-- dropped first and a row the gate had blocked gets its class back.
create or replace function public.fn_dq_gate_batch(p_batch_id uuid, p_channel text default 'sync', p_actor text default null, p_row_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r record; c jsonb; t text; v_tables text[]; v_key text; v_mode text; v_sql text; n int;
        v_blocked int := 0; v_warned int := 0; v_rules int := 0; v_errs text[] := '{}';
begin
  -- 1 · undo a previous pass on the rows in scope
  update public.sync_staged_row s
     set classification = coalesce((select f->>'prev' from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f ? 'prev' limit 1), s.classification)
   where s.batch_id = p_batch_id and (p_row_id is null or s.id = p_row_id) and not s.committed and s.classification = 'invalid'
     and exists (select 1 from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f ? 'prev');
  update public.sync_staged_row s
     set flags = coalesce((select jsonb_agg(f) from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where not (f ? 'rule')), '[]'::jsonb)
   where s.batch_id = p_batch_id and (p_row_id is null or s.id = p_row_id) and not s.committed;

  select array_agg(distinct target_table) into v_tables
  from public.sync_staged_row where batch_id = p_batch_id and (p_row_id is null or id = p_row_id) and not committed;

  -- 2 · every rule with a check on the table, on this channel, over the merged image (live row || staged payload)
  foreach t in array coalesce(v_tables, '{}'::text[]) loop
    v_key := public.fn_sync_key_column(t);
    for r in
      select ru.* from public.dq_rules ru
      where ru.enabled and ru.deleted_at is null and ru.kind in ('declarative','classification') and ru.tables @> array[t]
      order by ru.severity, ru.code
    loop
      v_mode := public.fn_dq_effective_mode(r.id, p_channel);
      if v_mode = 'audit' then continue; end if;
      for c in select x from jsonb_array_elements(r.checks) x where x->>'table' = t and coalesce(x->>'violation_sql', '') <> '' loop
        v_rules := v_rules + 1;
        begin
          v_sql := format($q$
            with hit as (
              select s.id, s.business_key from public.sync_staged_row s
              where s.batch_id = $1 and s.target_table = %L and not s.committed and s.classification in ('new','updated','invalid')
                and ($2::uuid is null or s.id = $2::uuid)
                and (select coalesce((%s), false)
                     from (select (jsonb_populate_record(null::public.%I,
                                     coalesce((select to_jsonb(e) from public.%I e where %s), '{}'::jsonb) || s.payload)).*) r))
            update public.sync_staged_row s
               set flags = coalesce(s.flags, '[]'::jsonb) || jsonb_build_object('level', %L, 'field', %L, 'msg', %L, 'rule', %L, 'mode', %L)
              from hit where s.id = hit.id
            returning s.id, s.business_key $q$,
            t, c->>'violation_sql', t, t,
            case when v_key is null then 'false' else format('e.%I::text = s.business_key', v_key) end,
            case when v_mode = 'block' then 'error' else 'warn' end, c->>'field',
            r.code || ' · ' || coalesce(c->>'message', r.description), r.code, v_mode);
          if v_mode = 'block' then
            execute 'with upd as (' || v_sql || ') insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, mode, message) '
                 || 'select $3, $4, $5, upd.business_key, $6, ''block'', $7 from upd'
              using p_batch_id, p_row_id, p_channel, r.code, t, p_actor, coalesce(c->>'message', r.description);
            get diagnostics n = row_count; v_blocked := v_blocked + n;
          else
            execute 'with upd as (' || v_sql || ') select count(*) from upd' using p_batch_id, p_row_id into n;
            v_warned := v_warned + coalesce(n, 0);
          end if;
        exception when others then
          v_errs := v_errs || format('%s on %s: %s', r.code, t, sqlerrm);
        end;
      end loop;
    end loop;
  end loop;

  -- 3 · block-level hits stop the commit: the row becomes invalid, remembering its class for a re-run
  update public.sync_staged_row s
     set flags = coalesce(s.flags, '[]'::jsonb) || jsonb_build_object('level', 'info', 'rule', 'GATE', 'prev', s.classification, 'msg', 'blocked by the data-quality gate on channel ' || p_channel || ' — fix the flagged cells and the row rejoins the commit'),
         classification = 'invalid'
   where s.batch_id = p_batch_id and (p_row_id is null or s.id = p_row_id) and not s.committed and s.classification in ('new','updated')
     and exists (select 1 from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f->>'level' = 'error' and f ? 'rule');

  return jsonb_build_object('blocked', v_blocked, 'warned', v_warned, 'rules', v_rules, 'tables', to_jsonb(coalesce(v_tables, '{}'::text[])), 'errors', to_jsonb(v_errs));
end $$;
revoke all on function public.fn_dq_gate_batch(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_dq_gate_batch(uuid, text, text, uuid) to service_role;

-- Manual Review syncs circular vessels that often lack DWT / type: keep the
-- required-columns rule advisory on that channel so the temporary sync still
-- works; the batch audit keeps counting the gap.
insert into public.dq_rule_channels (rule_id, channel, mode)
select id, 'review', 'warn' from public.dq_rules where code = 'DQ-K02'
on conflict do nothing;
