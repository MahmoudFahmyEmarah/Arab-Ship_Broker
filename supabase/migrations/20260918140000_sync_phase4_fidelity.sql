-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · phase 4 — data fidelity (18 Sep 2026)
--
--   sync_staged_row.source   the batch's source, denormalised onto the row
--       (backfilled, defaulted by trigger), so "what did THIS source say
--       last time" is a real question. The previous-value baseline used to
--       ignore the source: an email circular's payload became the baseline
--       for the next workbook upload of the same key, and vice versa.
--   fn_sync_previous_payloads   the latest committed payload per key for ONE
--       source, in one round trip — replaces an ordered read with an
--       arbitrary "keys × 4" limit that could miss keys with a long history.
--   fn_sync_unknown_ports       the port codes a cargo payload names that are
--       in neither the registry nor the batch's own ports sheet.
--   commit_sync_batch           REFUSES such a row (PORT_UNKNOWN) instead of
--       silently removing the code. Staging already flags the row invalid
--       (lib/sync/ports-check.ts); this is the backstop.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the source on the row ────────────────────────────────────────────────
alter table public.sync_staged_row add column if not exists source text;

update public.sync_staged_row s
   set source = b.source
  from public.sync_batch b
 where b.id = s.batch_id and s.source is null;

create or replace function public.fn_staged_row_source_default()
 returns trigger language plpgsql set search_path to ''
as $$
begin
  if new.source is null then
    select b.source into new.source from public.sync_batch b where b.id = new.batch_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_staged_row_source_default on public.sync_staged_row;
create trigger trg_staged_row_source_default
  before insert on public.sync_staged_row
  for each row execute function public.fn_staged_row_source_default();

create index if not exists idx_staged_prev_by_source
  on public.sync_staged_row (target_table, source, business_key, created_at desc)
  where committed;

comment on column public.sync_staged_row.source is 'upload | email | whatsapp — the batch''s source, so the previous-value baseline is scoped to the same source.';

-- ── 2 · the baseline, per source, in one query ──────────────────────────────
create or replace function public.fn_sync_previous_payloads(p_table text, p_source text, p_keys text[])
 returns table (business_key text, payload jsonb)
 language sql stable set search_path to ''
as $$
  select distinct on (s.business_key) s.business_key, s.payload
    from public.sync_staged_row s
   where s.target_table = p_table
     and s.source = p_source
     and s.committed
     and s.business_key = any (p_keys)
   order by s.business_key, s.created_at desc, s.id desc;
$$;

revoke all on function public.fn_sync_previous_payloads(text, text, text[]) from public, anon, authenticated;
grant execute on function public.fn_sync_previous_payloads(text, text, text[]) to service_role;

-- ── 3 · unknown ports are a refusal, not a silent edit ──────────────────────
create or replace function public.fn_sync_unknown_ports(p_payload jsonb, p_batch_ports text[])
 returns text[] language sql stable set search_path to ''
as $$
  select coalesce(array_agg(c.col || '=' || upper(p_payload ->> c.col) order by c.col), '{}'::text[])
    from unnest(array['load_port_locode','disch_port_locode',
                      'load_port_2_locode','load_port_3_locode','load_port_4_locode',
                      'disch_port_2_locode','disch_port_3_locode','disch_port_4_locode']) as c(col)
   where nullif(btrim(coalesce(p_payload ->> c.col, '')), '') is not null
     and not exists (select 1 from public.ports p where upper(p.locode) = upper(p_payload ->> c.col))
     and not (upper(p_payload ->> c.col) = any (coalesce(p_batch_ports, '{}'::text[])));
$$;

revoke all on function public.fn_sync_unknown_ports(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.fn_sync_unknown_ports(jsonb, text[]) to service_role;

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
  v_batch_ports text[];
  v_unknown  text[];
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

    -- phase 4: a port code the registry does not know is refused, never
    -- silently removed — the committed record must be what the reviewer saw
    if v_tbl = 'cargo_listings' then
      v_unknown := fn_sync_unknown_ports(r.payload, v_batch_ports);
      if coalesce(array_length(v_unknown, 1), 0) > 0 then
        raise exception 'PORT_UNKNOWN: row % (%) names port code(s) not in the registry: % — place them in Admin → Ports or correct the row, then run the gate again',
          coalesce(r.business_key, r.id::text), r.sheet, array_to_string(v_unknown, ', ')
          using errcode = '55000';
      end if;
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
