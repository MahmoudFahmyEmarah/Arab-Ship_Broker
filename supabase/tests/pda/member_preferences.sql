-- PDA · member preferences (20261018110000, O2ALL-008 increment D). BEGIN … ROLLBACK; run as the database owner.
--   M1  a member without a saved row reads the defaults (compact, estimate, saved=false)
--   M2  a member saves and reads back only their OWN row; another member still sees the defaults
--   M3  invalid values are refused (PDA_VALIDATION) and nothing is written
--   M4  gates: signed out → PDA_AUTH; T2 → PDA_TIER; the table has no API grant; RPC grants authenticated + service_role
begin;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  basic uuid := gen_random_uuid();
  r jsonb;
  e text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaPrefs1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (a, 'pda-pref-a@example.test'), (b, 'pda-pref-b@example.test'), (basic, 'pda-pref-basic@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (a, a, 'pda-pref-a@example.test', 'Pref A', 'cargo_owner', true, null, 'T3'),
    (b, b, 'pda-pref-b@example.test', 'Pref B', 'cargo_owner', true, null, 'T4'),
    (basic, basic, 'pda-pref-basic@example.test', 'Pref Basic', 'cargo_owner', true, null, 'T2');

  -- M4 · signed out
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin perform public.get_my_pda_preferences(); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'M4: signed out read must be PDA_AUTH, got %', e; end if;
  begin perform public.set_my_pda_preferences('comfortable', 'ports'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'M4: signed out write must be PDA_AUTH, got %', e; end if;

  -- M4 · T2
  perform set_config('request.jwt.claim.sub', basic::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',basic,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.set_my_pda_preferences('comfortable', 'ports'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_TIER' then raise exception 'M4: a T2 member must be PDA_TIER, got %', e; end if;

  -- M1 · defaults
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',a,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  r := public.get_my_pda_preferences();
  if r <> '{"density": "compact", "startTab": "estimate", "saved": false}'::jsonb then raise exception 'M1: defaults expected, got %', r; end if;

  -- M3 · validation, nothing written
  begin perform public.set_my_pda_preferences('huge', 'ports'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'M3: an invalid row height must be PDA_VALIDATION, got %', e; end if;
  begin perform public.set_my_pda_preferences('comfortable', 'agents'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'M3: an invalid start tab must be PDA_VALIDATION, got %', e; end if;
  begin perform public.set_my_pda_preferences(null, null); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'M3: nulls must be PDA_VALIDATION, got %', e; end if;
  if exists (select 1 from public.pda_member_preferences where user_id = a) then raise exception 'M3: a refused write left a row'; end if;

  -- M2 · save, read back, update; the other member is untouched
  r := public.set_my_pda_preferences('comfortable', 'ports');
  if r <> '{"density": "comfortable", "startTab": "ports", "saved": true}'::jsonb then raise exception 'M2: save must echo the values, got %', r; end if;
  if public.get_my_pda_preferences() <> '{"density": "comfortable", "startTab": "ports", "saved": true}'::jsonb then raise exception 'M2: read-back differs'; end if;
  r := public.set_my_pda_preferences('compact', 'ports');
  if (select count(*) from public.pda_member_preferences where user_id = a) <> 1
     or (select density from public.pda_member_preferences where user_id = a) <> 'compact' then raise exception 'M2: an update must keep one row'; end if;
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',b,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  if (public.get_my_pda_preferences())->>'saved' <> 'false' then raise exception 'M2: another member must not see A''s row'; end if;

  -- M4 · grants
  if exists (select 1 from unnest(array['anon','authenticated','service_role']) role, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
             where has_table_privilege(role, 'public.pda_member_preferences', p)) then
    raise exception 'M4: an API role holds a privilege on pda_member_preferences'; end if;
  if has_function_privilege('anon', 'public.get_my_pda_preferences()', 'execute')
     or has_function_privilege('anon', 'public.set_my_pda_preferences(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_my_pda_preferences(text, text)', 'execute') then
    raise exception 'M4: RPC grants must be authenticated + service_role only'; end if;

  raise notice 'M1–M4 ok: defaults, own-row save and read, validation, gates and grants';
end $$;

do $m$ begin raise notice 'PDA MEMBER PREFERENCES: ALL ASSERTIONS PASSED'; end $m$;
rollback;
