-- ── X1 · events, proposals, access log: nothing changes, nothing is deleted, for any role ─
do $$
declare v jsonb; v_room uuid; v_tid uuid; v_pid uuid; v_role text; v_ok boolean; v_bad text := '';
  procedure_sql text[];
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'immut-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 24}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'immut-bid');
  v_pid := (v->'data'->>'proposalId')::uuid;
  perform pg_temp.fx_owner();
  foreach v_role in array array['postgres', 'service_role'] loop
    execute format('set local role %I', v_role);
    procedure_sql := array[
      format('update public.fixture_events set payload = %L where room_id = %L', '{}', v_room),
      format('update public.fixture_events set seq = seq + 100 where room_id = %L', v_room),
      format('delete from public.fixture_events where room_id = %L', v_room),
      format('update public.fixture_proposals set display_value = %L where id = %L', 'tampered', v_pid),
      format('update public.fixture_proposals set value = %L where id = %L', '{"num": 99}', v_pid),
      format('delete from public.fixture_proposals where id = %L', v_pid),
      format('delete from public.fixture_rooms where id = %L', v_room)];
    for i in 1 .. array_length(procedure_sql, 1) loop
      v_ok := false;
      begin
        execute procedure_sql[i];
      exception when others then
        if sqlerrm like 'FX_IMMUTABLE:%' then v_ok := true; else v_bad := v_bad || format('[%s as %s → %s] ', procedure_sql[i], v_role, left(sqlerrm, 60)); end if;
      end;
      if not v_ok then v_bad := v_bad || format('[%s as %s ALLOWED] ', procedure_sql[i], v_role); end if;
    end loop;
    execute 'reset role';
  end loop;
  if v_bad <> '' then raise exception 'X1: %', v_bad; end if;
  -- the immutability trigger did its job: the proposal is what was submitted
  if (select display_value from public.fixture_proposals where id = v_pid) <> '$24.00/MT' then raise exception 'X1: proposal changed'; end if;
  raise notice 'X1 ok: events, proposals and rooms-with-history refuse UPDATE / DELETE as postgres and as service_role';
end $$;

-- ── X2 · bookkeeping columns change, nothing else ───────────────────────────
do $$
declare v jsonb; v_room uuid; v_mid uuid; v_recap uuid; v_sub uuid; v_ok boolean;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'immut-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  v := public.post_fixture_message(v_room, 'a note', 'note', 'room', null, pg_temp.fx_ver(v_room), 'immut-msg');
  v_mid := (v->'data'->>'messageId')::uuid;
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'freight'), '{"num": 24}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'immut-bid-2');
  v := public.publish_fixture_recap(v_room, pg_temp.fx_ver(v_room), 'immut-recap');
  v_recap := (v->'data'->>'recapVersionId')::uuid;
  v := public.add_fixture_subject(v_room, 'Sub stem', null, 'cargo', null, pg_temp.fx_ver(v_room), 'immut-sub');
  v_sub := (v->'data'->>'subjectId')::uuid;
  perform pg_temp.fx_owner();
  -- messages: redaction columns yes, body no
  update public.fixture_messages set redacted_at = now() where id = v_mid;
  v_ok := false;
  begin update public.fixture_messages set body = 'edited' where id = v_mid; exception when others then v_ok := sqlerrm like 'FX_IMMUTABLE:%'; end;
  if not v_ok then raise exception 'X2: message body must be immutable'; end if;
  -- recaps: invalidation yes, content no
  update public.fixture_recap_versions set invalidated_at = now() where id = v_recap;
  v_ok := false;
  begin update public.fixture_recap_versions set content_text = 'x' where id = v_recap; exception when others then v_ok := sqlerrm like 'FX_IMMUTABLE:%'; end;
  if not v_ok then raise exception 'X2: recap content must be immutable'; end if;
  -- subjects: resolution / deadline yes, title no
  update public.fixture_subjects set deadline_at = now() + interval '1 day', extended_count = extended_count + 1 where id = v_sub;
  v_ok := false;
  begin update public.fixture_subjects set title = 'renamed' where id = v_sub; exception when others then v_ok := sqlerrm like 'FX_IMMUTABLE:%'; end;
  if not v_ok then raise exception 'X2: subject title must be immutable'; end if;
  v_ok := false;
  begin delete from public.fixture_subjects where id = v_sub; exception when others then v_ok := sqlerrm like 'FX_IMMUTABLE:%'; end;
  if not v_ok then raise exception 'X2: subjects cannot be deleted'; end if;
  raise notice 'X2 ok: only redaction, invalidation and subject resolution columns may change';
end $$;
