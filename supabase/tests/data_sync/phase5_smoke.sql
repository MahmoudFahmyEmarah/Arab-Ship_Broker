-- Phase 5 smoke — exercises the encrypted LLM key manager + email config against
-- live Supabase Vault, then rolls back. Paste the DO block into the SQL editor
-- (it self-aborts with SMOKE_OK) or run wrapped in BEGIN/ROLLBACK.

begin;
do $$
declare v_id1 uuid; v_id2 uuid; v_secret_id uuid;
begin
  -- create + encrypt + decrypt round-trip
  v_id1 := public.save_llm_credential(null,'Primary','anthropic','claude-sonnet-4',null,'sk-ant-secret-abcd', true);
  assert (select key_hint from public.llm_credential where id=v_id1)='abcd', 'hint wrong';
  assert (select is_active from public.llm_credential where id=v_id1), 'not active';
  assert public.get_llm_secret(v_id1)='sk-ant-secret-abcd', 'decrypt failed';

  -- one-active invariant
  v_id2 := public.save_llm_credential(null,'Backup','openai','gpt-4o',null,'sk-openai-xyz9', true);
  assert (select count(*) from public.llm_credential where is_active)=1, 'more than one active';

  -- switch + rotate + keep-on-null
  perform public.set_active_llm_credential(v_id1);
  assert (select is_active from public.llm_credential where id=v_id1), 'switch failed';
  perform public.save_llm_credential(v_id1,'Primary','anthropic','claude-sonnet-4',null,'sk-ant-ROTATED-9999', false);
  assert public.get_llm_secret(v_id1)='sk-ant-ROTATED-9999', 'rotate failed';
  perform public.save_llm_credential(v_id1,'Primary Renamed','anthropic','claude-opus-4',null,null, false);
  assert public.get_llm_secret(v_id1)='sk-ant-ROTATED-9999', 'null-secret update wiped the key';

  -- delete destroys the Vault ciphertext
  select secret_id into v_secret_id from public.llm_credential where id=v_id2;
  perform public.delete_llm_credential(v_id2);
  assert not exists (select 1 from vault.secrets where id=v_secret_id), 'vault ciphertext leaked';

  -- email config: password → Vault, hint, keep-on-null, singleton
  perform public.save_email_config('gmail','imap.gmail.com',993,'ops@x.com','INBOX','label:circulation','app-pw-1234',true);
  assert public.get_email_password()='app-pw-1234', 'email pw decrypt failed';
  assert (select password_hint from public.email_ingest_config where only_one)='1234', 'email hint wrong';
  perform public.save_email_config('gmail','imap.gmail.com',993,'ops@x.com','Circulation','label:circulation',null,true);
  assert public.get_email_password()='app-pw-1234', 'null-pw update wiped the secret';
  assert (select count(*) from public.email_ingest_config)=1, 'singleton broken';

  raise notice 'SMOKE_OK: LLM key manager + email config Vault paths all passed';
end $$;
rollback;
