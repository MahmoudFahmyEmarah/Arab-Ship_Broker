-- DOWN for 20260918130000_sync_phase3_gate_mandatory.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_phase3_down.sql
--   supabase migration repair --status reverted 20260918130000
-- Deploy the pre-phase-3 application first (it no longer calls regate_sync_batch).
-- Function bodies are restored below, verbatim, from their last migrations:
--   commit_sync_batch                → 20260918120000 (phase 2 body)
--   fn_dq_gate_batch                 → 20260909150000
--   fn_dq_forms_gate                 → 20260917120000
--   edit_live_record                 → 20260704120000   (bulk_update_live_records too)
--   insert_live_record               → 20260731110000

drop function if exists public.regate_sync_batch(uuid, text, text);   -- also undoes 20260918160000
drop function if exists public.fn_sync_batch_recount(uuid);
drop function if exists public.fn_sync_gate_stale(uuid, text, uuid[]);
drop function if exists public.fn_dq_rules_version();

alter table public.sync_staged_row drop constraint if exists sync_staged_row_gate_status_chk;
alter table public.sync_staged_row
  drop column if exists gate_status,
  drop column if exists gate_rules_version,
  drop column if exists gate_payload_hash,
  drop column if exists gated_at;

-- the pre-phase-3 function bodies, verbatim
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
begin
  -- One commit of a batch at a time: a concurrent caller waits here and then
  -- finds nothing left to commit.
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
    raise exception 'BATCH_STATE: the data-quality gate did not run on this batch — re-run the gate first' using errcode = '55000';
  end if;
  if b.status = 'committing' then
    raise exception 'BATCH_STATE: another commit of this batch is in progress' using errcode = '55000';
  end if;
  -- draft (staged before phase 2), gated, partial, failed → proceed
  v_resting := case when b.status = 'failed' then 'gated' else b.status end;

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

    -- Auto-approve admin-synced marketplace listings so they are immediately
    -- live on the public boards/counts. Re-read v_after so the reversible-commit
    -- audit captures the approved state (Undo restores the pre-commit row).
    if v_tbl in ('cargo_listings','vessel_availability') then
      execute format(
        'update public.%I set review_status = ''APPROVED'',
           goes_live_at = coalesce(goes_live_at, now())
         where %I::text = $1', v_tbl, v_keycol)
        using r.business_key;
      execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', v_tbl, v_keycol)
        into v_after using r.business_key;
    end if;

    -- idx_commit_audit_active_row refuses a second active audit row for the
    -- same staged row — a duplicate commit can never slip through here
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
  -- This write rolls back with the raise (the transaction is aborted); it
  -- stays as documentation. The application records the failure through
  -- mark_sync_batch_failed in a second statement.
  update public.sync_batch set status = 'failed', error = SQLERRM where id = p_batch_id;
  raise;
end;
$function$;
revoke all on function public.commit_sync_batch(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.commit_sync_batch(uuid, text, uuid[]) to service_role;

create or replace function public.fn_dq_gate_batch(p_batch_id uuid, p_channel text default 'sync', p_actor text default null, p_row_id uuid default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r record; c jsonb; t text; v_tables text[]; v_key text; v_mode text; v_sql text; v_hits jsonb; n int;
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
      where ru.enabled and ru.deleted_at is null and ru.kind in ('declarative', 'classification') and ru.tables @> array[t]
      order by ru.severity, ru.code
    loop
      v_mode := public.fn_dq_effective_mode(r.id, p_channel);
      if v_mode = 'audit' then continue; end if;
      for c in select x from jsonb_array_elements(r.checks) x where x->>'table' = t and coalesce(x->>'violation_sql', '') <> '' loop
        v_rules := v_rules + 1;
        begin
          v_sql := format($q$
            select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'bk', s.business_key)), '[]'::jsonb)
              from public.sync_staged_row s
             where s.batch_id = $1 and s.target_table = %L and not s.committed and s.classification in ('new', 'updated', 'invalid')
               and ($2::uuid is null or s.id = $2::uuid)
               and (select coalesce((%s), false)
                    from (select (jsonb_populate_record(null::public.%I,
                                    coalesce((select to_jsonb(e) from public.%I e where %s), '{}'::jsonb) || s.payload)).*) r) $q$,
            t, c->>'violation_sql', t, t,
            case when v_key is null then 'false' else format('e.%I::text = s.business_key', v_key) end);
          v_hits := public.fn_dq_eval_hits(v_sql, p_batch_id, p_row_id);
          n := jsonb_array_length(v_hits);
          if n > 0 then
            update public.sync_staged_row s
               set flags = coalesce(s.flags, '[]'::jsonb) || jsonb_build_object('level', case when v_mode = 'block' then 'error' else 'warn' end, 'field', c->>'field',
                                                                                   'msg', r.code || ' · ' || coalesce(c->>'message', r.description), 'rule', r.code, 'mode', v_mode)
             where s.id in (select (h->>'id')::uuid from jsonb_array_elements(v_hits) h);
            if v_mode = 'block' then
              insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, mode, message)
              select p_channel, r.code, t, h->>'bk', p_actor, 'block', coalesce(c->>'message', r.description) from jsonb_array_elements(v_hits) h;
              v_blocked := v_blocked + n;
            else
              v_warned := v_warned + n;
            end if;
          end if;
        exception when others then
          v_errs := v_errs || format('%s on %s: %s', r.code, t, sqlerrm);
          insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, mode, message)
          values (p_channel, r.code, t, null, p_actor, 'error', left('rule did not evaluate: ' || sqlerrm, 500));
        end;
      end loop;
    end loop;
  end loop;

  -- 3 · block-level hits stop the commit: the row becomes invalid, remembering its class for a re-run
  update public.sync_staged_row s
     set flags = coalesce(s.flags, '[]'::jsonb) || jsonb_build_object('level', 'info', 'rule', 'GATE', 'prev', s.classification, 'msg', 'blocked by the data-quality gate on channel ' || p_channel || ' — fix the flagged cells and the row rejoins the commit'),
         classification = 'invalid'
   where s.batch_id = p_batch_id and (p_row_id is null or s.id = p_row_id) and not s.committed and s.classification in ('new', 'updated')
     and exists (select 1 from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f->>'level' = 'error' and f ? 'rule');

  return jsonb_build_object('blocked', v_blocked, 'warned', v_warned, 'rules', v_rules, 'tables', to_jsonb(coalesce(v_tables, '{}'::text[])), 'errors', to_jsonb(v_errs));
end $function$;
revoke all on function public.fn_dq_gate_batch(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_dq_gate_batch(uuid, text, text, uuid) to service_role;

create or replace function public.fn_dq_forms_gate()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  v_claims  jsonb;
  v_channel text;
  v_enforce boolean;
  v_gate    jsonb;
  v_why     text;
  v_actor   text;
  v_actor_id uuid;
begin
  v_channel := nullif(current_setting('dq.channel', true), '');
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  if v_channel is null then
    -- a signed-in MEMBER writing through PostgREST (Post Cargo, Post Position,
    -- Register Vessel, My Vessels). Service-role paths gate themselves, and an
    -- administrator's own session (review-queue approval, admin edits) is
    -- gated explicitly on its own channel — never judged again as a form.
    if coalesce(v_claims->>'role', '') = 'authenticated' and not public.fn_is_admin() then
      v_channel := 'forms';
    else
      return new;
    end if;
  end if;

  select coalesce(s.gate_forms_enforce, false) into v_enforce from public.dq_settings s where s.id = 1;
  v_enforce := coalesce(v_enforce, false);
  v_actor := coalesce(v_claims->>'email', v_channel);
  if (v_claims->>'sub') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_actor_id := (v_claims->>'sub')::uuid;
  end if;

  begin
    v_gate := public.fn_dq_validate(tg_table_name::text, to_jsonb(new), v_channel, v_actor, v_actor_id, true);
  exception when others then
    if v_enforce then
      -- fail closed: an unavailable gate is not a pass
      raise exception 'DQ_GATE: the data-quality gate could not run (%). Nothing was saved — please try again, or ask an administrator.', sqlerrm
        using errcode = 'check_violation';
    end if;
    return new;
  end;

  if v_enforce and coalesce((v_gate->>'errors')::integer, 0) > 0 then
    -- fail closed: a rule that could not be evaluated is not a pass. The rule
    -- is named in dq_gate_log (mode "error") — this write's own log entry
    -- rolls back with it, earlier shadow-mode entries do not.
    raise exception 'DQ_GATE: % data-quality rule(s) could not be evaluated, so the write was refused. Nothing was saved — try again, or ask an administrator to check Data quality → Gate → log.',
      (v_gate->>'errors')::integer
      using errcode = 'check_violation';
  end if;

  if v_enforce and coalesce((v_gate->>'blocked')::boolean, false) then
    select string_agg((i->>'rule_code') || ' — ' || (i->>'message'), '; ')
      into v_why
      from jsonb_array_elements(coalesce(v_gate->'issues', '[]'::jsonb)) i
     where i->>'mode' = 'block';
    raise exception 'DQ_GATE: %', coalesce(v_why, 'refused by the data-quality gate')
      using errcode = 'check_violation',
            hint = 'Rule modes per channel are set in Admin → Data quality → Gate.';
  end if;
  return new;
end $function$;
revoke all on function public.fn_dq_forms_gate() from public;

create or replace function public.edit_live_record(
  p_table text, p_key text, p_patch jsonb, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_key_col  text;
  v_set      text;
  v_before   jsonb;
  v_after    jsonb;
  v_audit_id uuid;
begin
  if not public.fn_sync_table_allowed(p_table) then
    raise exception 'table % is not editable', p_table using errcode = '42501';
  end if;
  v_key_col := public.fn_sync_key_column(p_table);
  if v_key_col is null then raise exception 'no business key for %', p_table; end if;

  v_set := public.fn_edit_set_list(p_table, p_patch, v_key_col);
  if v_set is null then raise exception 'no editable fields in patch' using errcode = '22023'; end if;

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_before using p_key;
  if v_before is null then
    raise exception 'record % not found in %', p_key, p_table using errcode = 'P0002';
  end if;

  execute format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) as s where t.%I::text = $2',
    p_table, v_set, p_table, v_key_col
  ) using p_patch, p_key;

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_after using p_key;

  insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by)
  values (p_table, p_key, 'update', v_before, v_after, p_actor)
  returning id into v_audit_id;

  return jsonb_build_object('audit_id', v_audit_id, 'after', v_after);
end $$;
revoke all on function public.edit_live_record(text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.edit_live_record(text, text, jsonb, uuid) to service_role;

create or replace function public.bulk_update_live_records(
  p_table text, p_keys text[], p_patch jsonb, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_key_col text;
  v_set     text;
  v_group   uuid := gen_random_uuid();
  v_key     text;
  v_before  jsonb;
  v_after   jsonb;
  v_n       int := 0;
begin
  if not public.fn_sync_table_allowed(p_table) then
    raise exception 'table % is not editable', p_table using errcode = '42501';
  end if;
  v_key_col := public.fn_sync_key_column(p_table);
  v_set := public.fn_edit_set_list(p_table, p_patch, v_key_col);
  if v_set is null then raise exception 'no editable fields in patch' using errcode = '22023'; end if;

  foreach v_key in array p_keys loop
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
      into v_before using v_key;
    if v_before is null then continue; end if;
    execute format(
      'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) as s where t.%I::text = $2',
      p_table, v_set, p_table, v_key_col
    ) using p_patch, v_key;
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
      into v_after using v_key;
    insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by, group_id)
    values (p_table, v_key, 'update', v_before, v_after, p_actor, v_group);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('updated', v_n, 'group_id', v_group);
end $$;
revoke all on function public.bulk_update_live_records(text, text[], jsonb, uuid) from public, anon, authenticated;
grant execute on function public.bulk_update_live_records(text, text[], jsonb, uuid) to service_role;

create or replace function public.insert_live_record(
  p_table text, p_row jsonb, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_key_col text;
  v_key     text;
  v_cols    text;
  v_sel     text;
  v_exists  jsonb;
  v_after   jsonb;
  v_audit_id uuid;
begin
  if not public.fn_sync_table_allowed(p_table) then
    raise exception 'table % is not editable', p_table using errcode = '42501';
  end if;
  v_key_col := public.fn_sync_key_column(p_table);
  if v_key_col is null then raise exception 'no business key for %', p_table; end if;

  v_key := btrim(coalesce(p_row ->> v_key_col, ''));
  if v_key = '' then
    raise exception '% is required', v_key_col using errcode = '22023';
  end if;

  -- duplicate business key → clean error before any dynamic insert runs
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_exists using v_key;
  if v_exists is not null then
    raise exception '"%" already exists in %', v_key, p_table using errcode = '23505';
  end if;

  -- real, non-generated columns present in the row; id/timestamps keep defaults
  select string_agg(quote_ident(c.column_name), ', '),
         string_agg(format('s.%I', c.column_name), ', ')
    into v_cols, v_sel
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and c.is_generated = 'NEVER'
    and c.column_name = any (select jsonb_object_keys(p_row))
    and c.column_name not in ('id', 'created_at', 'updated_at');
  if v_cols is null then raise exception 'no insertable fields' using errcode = '22023'; end if;

  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) as s',
    p_table, v_cols, v_sel, p_table
  ) using p_row;

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_after using v_key;

  insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by)
  values (p_table, v_key, 'insert', null, v_after, p_actor)
  returning id into v_audit_id;

  return jsonb_build_object('audit_id', v_audit_id, 'after', v_after);
end $$;
revoke all on function public.insert_live_record(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.insert_live_record(text, jsonb, uuid) to service_role;
