-- Contract for 20261029100000_llm_credential_conditional_activation (Codex C2O-178). Runs as postgres inside
-- BEGIN … ROLLBACK; leaves the database as it found it. Prints the marker on success; any failure raises.
begin;

do $t$
declare
  v_a uuid; v_b uuid; v_tok timestamptz; v_tok_b timestamptz; v_r text; v_n int; v_active uuid;
  v_save regprocedure := 'public.save_llm_credential(uuid,text,text,text,text,text,boolean)'::regprocedure;
  v_cond regprocedure := 'public.set_active_llm_credential_if_unchanged(uuid,timestamptz)'::regprocedure;
begin
  -- L1 · grants: both functions are service-only
  if has_function_privilege('anon', v_cond, 'execute') or has_function_privilege('authenticated', v_cond, 'execute')
     or has_function_privilege('anon', v_save, 'execute') or has_function_privilege('authenticated', v_save, 'execute') then
    raise exception 'L1: an API role can execute a credential function';
  end if;
  if not has_function_privilege('service_role', v_cond, 'execute') then raise exception 'L1: service_role cannot activate'; end if;
  if not has_function_privilege('service_role', v_save, 'execute') then raise exception 'L1: service_role cannot save'; end if;

  -- L2 · a new key is saved inactive even when p_make_active is true (the deployed app's old call)
  v_a := public.save_llm_credential(null, 'llm-contract A', 'anthropic', 'claude-haiku-5-5', null, 'sk-ant-contract-aaaa', true);
  select is_active, updated_at into strict v_r, v_tok from (select is_active::text, updated_at from public.llm_credential where id = v_a) s;
  if v_r <> 'false' then raise exception 'L2: a new key was saved active'; end if;

  -- L3 · conditional activation with the token the test read → activated; exactly one active key
  v_r := public.set_active_llm_credential_if_unchanged(v_a, v_tok);
  if v_r <> 'activated' then raise exception 'L3: expected activated, got %', v_r; end if;
  select count(*) into v_n from public.llm_credential where is_active;
  if v_n <> 1 then raise exception 'L3: % active keys', v_n; end if;

  -- L4 · editing the ACTIVE key takes it out of service at once (no untested values ever live)
  select updated_at into v_tok from public.llm_credential where id = v_a;
  perform public.save_llm_credential(v_a, 'llm-contract A', 'anthropic', 'claude-sonnet-5-5', null, null, true);
  if (select is_active from public.llm_credential where id = v_a) then raise exception 'L4: an edited active key stayed active'; end if;
  if (select key_hint from public.llm_credential where id = v_a) <> 'aaaa' then raise exception 'L4: keeping the secret lost its hint'; end if;

  -- L5 · the token the earlier test read is now stale → 'changed', nothing activated
  v_r := public.set_active_llm_credential_if_unchanged(v_a, v_tok);
  if v_r <> 'changed' then raise exception 'L5: a stale token was accepted (%)', v_r; end if;
  if exists (select 1 from public.llm_credential where id = v_a and is_active) then raise exception 'L5: activated on a stale token'; end if;
  if public.set_active_llm_credential_if_unchanged(v_a, null) <> 'changed' then raise exception 'L5: a null token was accepted'; end if;

  -- L6 · switching: activating B with its fresh token deactivates A; single active key holds
  select updated_at into v_tok from public.llm_credential where id = v_a;
  perform public.set_active_llm_credential_if_unchanged(v_a, v_tok);
  v_b := public.save_llm_credential(null, 'llm-contract B', 'groq', 'openai/gpt-oss-20b', 'https://api.groq.com/openai/v1', 'gsk-contract-bbbb', false);
  select updated_at into v_tok_b from public.llm_credential where id = v_b;
  if public.set_active_llm_credential_if_unchanged(v_b, v_tok_b) <> 'activated' then raise exception 'L6: B not activated'; end if;
  select id into strict v_active from public.llm_credential where is_active;
  if v_active <> v_b then raise exception 'L6: the active key is not B'; end if;

  -- L8 · editing a NON-active key leaves the active one (B) untouched
  perform public.save_llm_credential(v_a, 'llm-contract A2', 'anthropic', 'claude-haiku-5-5', null, null, false);
  select id into strict v_active from public.llm_credential where is_active;
  if v_active <> v_b then raise exception 'L8: editing an inactive key changed the active one'; end if;

  -- L7 · unknown id
  if public.set_active_llm_credential_if_unchanged(gen_random_uuid(), now()) <> 'not_found' then raise exception 'L7: unknown id not refused'; end if;

  raise notice 'LLM CONDITIONAL ACTIVATION: ALL ASSERTIONS PASSED';
end
$t$;

rollback;
