-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · phase 3 — the gate becomes mandatory (18 Sep 2026)
--
-- Before: staging caught a gate failure and left the batch committable;
-- commit trusted whatever classification was stored; a rule that failed to
-- evaluate was a silent pass; Database Preview edits never met the gate.
--
-- Now:
--   sync_staged_row.gate_status / gate_rules_version / gate_payload_hash /
--       gated_at   the gate's verdict is persisted per row, together with the
--       payload hash it judged and the rules version in force.
--   fn_dq_gate_batch   writes those columns. A rule that could not be
--       evaluated marks every row of that table gate_status = 'error' —
--       a fail-closed verdict, not a silent pass.
--   commit_sync_batch  refuses (GATE_STALE) any row in scope whose gate
--       verdict is missing, not 'ok', judged a different payload than the
--       one about to be written, or judged under older rules. An edit in
--       Review therefore re-gates the row before it can be committed.
--   regate_sync_batch  runs the gate again on a batch, recounts it and
--       settles its status ('gated' / 'gate_failed').
--   edit_live_record / insert_live_record  name their channel ('admin')
--       so trg_*_zz_dq_gate evaluates them; an explicit channel always
--       enforces and fails closed, whatever the member-forms shadow switch.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the verdict lives on the row ────────────────────────────────────────
alter table public.sync_staged_row
  add column if not exists gate_status        text,
  add column if not exists gate_rules_version timestamptz,
  add column if not exists gate_payload_hash  text,
  add column if not exists gated_at           timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sync_staged_row_gate_status_chk') then
    alter table public.sync_staged_row add constraint sync_staged_row_gate_status_chk
      check (gate_status is null or gate_status in ('ok', 'blocked', 'error'));
  end if;
end $$;

comment on column public.sync_staged_row.gate_status        is 'ok | blocked | error — the data-quality gate''s verdict on gate_payload_hash under gate_rules_version. null = never gated (refused by commit).';
comment on column public.sync_staged_row.gate_payload_hash  is 'md5 of the payload the gate judged; commit refuses a row whose payload changed since.';
comment on column public.sync_staged_row.gate_rules_version is 'The rules version in force when the gate ran (fn_dq_rules_version); commit refuses a row gated under older rules.';

-- The rules version: the newest change to any rule or any channel mode.
create or replace function public.fn_dq_rules_version()
 returns timestamptz language sql stable set search_path to ''
as $$
  select greatest(
    coalesce((select max(updated_at) from public.dq_rules), '1970-01-01'::timestamptz),
    coalesce((select max(updated_at) from public.dq_rule_channels), '1970-01-01'::timestamptz));
$$;

-- ── 2 · the gate persists its verdict ───────────────────────────────────────
create or replace function public.fn_dq_gate_batch(p_batch_id uuid, p_channel text default 'sync', p_actor text default null, p_row_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r record; c jsonb; t text; v_tables text[]; v_key text; v_mode text; v_sql text; n int;
        v_blocked int := 0; v_warned int := 0; v_rules int := 0; v_errs text[] := '{}'; v_err_tables text[] := '{}';
        v_version timestamptz := public.fn_dq_rules_version();
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
          -- phase 3: not a silent pass — every row of this table is marked
          -- gate_status = 'error' below, and commit refuses it
          v_errs := v_errs || format('%s on %s: %s', r.code, t, sqlerrm);
          v_err_tables := array_append(v_err_tables, t);
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

  -- 4 · persist the verdict with the payload it judged and the rules in force
  update public.sync_staged_row s
     set gate_status = case
           when s.target_table = any (v_err_tables) then 'error'
           when exists (select 1 from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f->>'rule' = 'GATE') then 'blocked'
           else 'ok' end,
         gate_payload_hash  = md5(s.payload::text),
         gate_rules_version = v_version,
         gated_at           = now()
   where s.batch_id = p_batch_id and (p_row_id is null or s.id = p_row_id) and not s.committed;

  return jsonb_build_object('blocked', v_blocked, 'warned', v_warned, 'rules', v_rules, 'tables', to_jsonb(coalesce(v_tables, '{}'::text[])), 'errors', to_jsonb(v_errs), 'rules_version', v_version);
end $$;
revoke all on function public.fn_dq_gate_batch(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_dq_gate_batch(uuid, text, text, uuid) to service_role;

-- ── 3 · commit refuses what the gate has not passed ─────────────────────────
-- Rows in scope that may NOT be committed, with the reason.
create or replace function public.fn_sync_gate_stale(p_batch_id uuid, p_sheet text default null, p_row_ids uuid[] default null)
 returns table (row_id uuid, business_key text, sheet text, reason text)
 language sql stable set search_path to ''
as $$
  select s.id, s.business_key, s.sheet,
         case
           when s.gate_status is null then 'never checked by the gate'
           when s.gate_status = 'error' then 'a data-quality rule could not be evaluated for this row'
           when s.gate_status = 'blocked' then 'blocked by the gate'
           when s.gate_payload_hash is distinct from md5(s.payload::text) then 'edited since the gate checked it'
           when s.gate_rules_version < public.fn_dq_rules_version() then 'the rules changed since the gate checked it'
         end
    from public.sync_staged_row s
   where s.batch_id = p_batch_id
     and (p_sheet is null or s.sheet = p_sheet)
     and (p_row_ids is null or s.id = any (p_row_ids))
     and not s.committed
     and s.classification in ('new', 'updated')
     and (s.gate_status is null
       or s.gate_status <> 'ok'
       or s.gate_payload_hash is distinct from md5(s.payload::text)
       or s.gate_rules_version < public.fn_dq_rules_version());
$$;

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
revoke all on function public.fn_sync_gate_stale(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.fn_sync_gate_stale(uuid, text, uuid[]) to service_role;

-- ── 4 · run the gate again, recount, settle the status ──────────────────────
create or replace function public.fn_sync_batch_recount(p_batch_id uuid)
 returns jsonb language sql stable set search_path to ''
as $$
  select coalesce(jsonb_object_agg(sheet, c), '{}'::jsonb)
    from (
      select s.sheet,
             jsonb_build_object(
               'new',       count(*) filter (where s.classification = 'new'),
               'updated',   count(*) filter (where s.classification = 'updated'),
               'unchanged', count(*) filter (where s.classification = 'unchanged'),
               'invalid',   count(*) filter (where s.classification = 'invalid'),
               'errors',    count(*) filter (where exists (select 1 from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f->>'level' = 'error'))
             ) as c
        from public.sync_staged_row s
       where s.batch_id = p_batch_id
       group by s.sheet
    ) x;
$$;

create or replace function public.regate_sync_batch(p_batch_id uuid, p_channel text default 'sync', p_actor text default null)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare b public.sync_batch%rowtype; g jsonb;
begin
  select * into b from public.sync_batch where id = p_batch_id for update;
  if not found then raise exception 'sync batch % not found', p_batch_id; end if;
  if b.status in ('committed', 'undone', 'committing') then
    raise exception 'BATCH_STATE: a % batch has nothing left to gate', b.status using errcode = '55000';
  end if;
  begin
    g := public.fn_dq_gate_batch(p_batch_id, p_channel, p_actor, null);
  exception when others then
    update public.sync_batch set status = 'gate_failed', error = left('gate: ' || sqlerrm, 2000) where id = p_batch_id;
    raise exception 'GATE_FAILED: the data-quality gate could not run — %', sqlerrm using errcode = '55000';
  end;
  update public.sync_batch
     set counts = public.fn_sync_batch_recount(p_batch_id),
         status = case when b.status in ('draft', 'gated', 'gate_failed', 'failed') then 'gated' else b.status end,
         error  = null
   where id = p_batch_id;
  return g;
end $$;

revoke all on function public.fn_sync_batch_recount(uuid) from public, anon, authenticated;
revoke all on function public.regate_sync_batch(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_sync_batch_recount(uuid) to service_role;
grant execute on function public.regate_sync_batch(uuid, text, text) to service_role;

-- ── 5 · live edits meet the gate, on their own channel, fail closed ────────
create or replace function public.fn_dq_forms_gate()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  v_claims  jsonb;
  v_channel text;
  v_explicit boolean;
  v_enforce boolean;
  v_gate    jsonb;
  v_why     text;
  v_actor   text;
  v_actor_id uuid;
begin
  v_channel := nullif(current_setting('dq.channel', true), '');
  v_explicit := v_channel is not null;
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

  -- Phase 3 (18 Sep 2026): a write that NAMES its channel (Database Preview
  -- edits set 'admin', a partner API would set 'api') is always enforced and
  -- fails closed; the shadow switch only governs the inferred forms channel.
  if v_explicit then
    v_enforce := true;
  else
    select coalesce(s.gate_forms_enforce, false) into v_enforce from public.dq_settings s where s.id = 1;
    v_enforce := coalesce(v_enforce, false);
  end if;
  v_actor := coalesce(v_claims->>'email', v_channel);
  if (v_claims->>'sub') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_actor_id := (v_claims->>'sub')::uuid;
  end if;

  begin
    v_gate := public.fn_dq_validate(tg_table_name::text, to_jsonb(new), v_channel, v_actor, v_actor_id, true);
  exception when others then
    if v_enforce then
      raise exception 'DQ_GATE: the data-quality gate could not run (%). Nothing was saved — please try again, or ask an administrator.', sqlerrm
        using errcode = 'check_violation';
    end if;
    return new;
  end;

  if v_enforce and coalesce((v_gate->>'errors')::integer, 0) > 0 then
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

-- edit_live_record / insert_live_record: name the channel. The bodies are
-- those of 20260704120000 / 20260731110000 with one line added each.
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
  perform set_config('dq.channel', 'admin', true);   -- phase 3: the gate judges this write on the admin channel
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
  perform set_config('dq.channel', 'admin', true);   -- phase 3: the gate judges this write on the admin channel
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

-- bulk_update_live_records: the body of 20260704120000 with the channel line.
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
  perform set_config('dq.channel', 'admin', true);   -- phase 3: the gate judges these writes on the admin channel
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

revoke all on function public.edit_live_record(text, text, jsonb, uuid)   from public, anon, authenticated;
revoke all on function public.insert_live_record(text, jsonb, uuid)        from public, anon, authenticated;
grant execute on function public.edit_live_record(text, text, jsonb, uuid)   to service_role;
grant execute on function public.insert_live_record(text, jsonb, uuid)        to service_role;
revoke all on function public.bulk_update_live_records(text, text[], jsonb, uuid) from public, anon, authenticated;
grant execute on function public.bulk_update_live_records(text, text[], jsonb, uuid) to service_role;
