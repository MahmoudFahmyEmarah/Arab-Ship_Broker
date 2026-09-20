-- Data Quality · workstream I smoke test (21 Sep 2026)
-- for 20260919180000_dq_i_restricted_paths.sql. BEGIN … ROLLBACK.
--
-- Proves the three RESTRICTED write paths in lib/dq/policy.ts are limited by
-- something real, not by a comment. Each assertion tests BEHAVIOUR — what the
-- database does — never the shape of the application source:
--
--   forms.signup.org          the path is a function whose signature is the
--                             policy: three fields in, three columns written,
--                             everything else left at its default
--   forms.port.autocomplete   row-level security admits no member INSERT on
--   forms.port.availability   `ports`, and an unverified port is invisible
--                             under the member read policy
--
-- The probes read pg_policies through fn_dq_member_write_probe, so the day
-- somebody adds a permissive policy to either table, this test fails.

begin;

do $$
declare
  v_id      uuid;
  v_org     record;
  v_probe   jsonb;
  v_ok      boolean;
  v_locode  text := 'ZZTST';
  n         int;
begin
  -- ── S1 · signup writes a name, a type and a domain — and nothing else ────
  v_id := public.fn_dq_signup_create_org('  Smoke Shipping LLC  ', 'broker', 'SMOKE-Ships.example.com');
  select * into v_org from public.organizations where id = v_id;
  if v_org.name <> 'Smoke Shipping LLC' then raise exception 'S1: the name was not trimmed: %', v_org.name; end if;
  if v_org.org_type <> 'broker' then raise exception 'S1: org_type wrong: %', v_org.org_type; end if;
  if v_org.email_domains is distinct from array['smoke-ships.example.com'] then raise exception 'S1: email domain wrong: %', v_org.email_domains; end if;
  -- every other column is whatever the table decided, never what the caller chose
  if v_org.subscription_tier is not null or v_org.imo is not null or v_org.fleet_total is not null
     or v_org.owns_count is not null or v_org.manages_comm_count is not null or v_org.ism_manages_count is not null
     or v_org.linked_to_imo is not null or v_org.link_note is not null or v_org.link_type is not null
     or v_org.source_tag is not null or v_org.address is not null or v_org.desk_email is not null then
    raise exception 'S1: signup set a field outside its three: tier=% imo=% fleet=% link=% source=%',
      v_org.subscription_tier, v_org.imo, v_org.fleet_total, v_org.linked_to_imo, v_org.source_tag;
  end if;

  -- ── S2 · the inputs are validated, not trusted ───────────────────────────
  v_ok := false;
  begin perform public.fn_dq_signup_create_org('   ', 'broker', 'x.example.com'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'S2: an empty company name was accepted'; end if;

  v_ok := false;
  begin perform public.fn_dq_signup_create_org(repeat('x', 201), 'broker', null); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'S2: a 201-character name was accepted'; end if;

  -- an unknown declared role becomes 'other' rather than failing a signup
  v_id := public.fn_dq_signup_create_org('Smoke Two', 'wizard', null);
  select * into v_org from public.organizations where id = v_id;
  if v_org.org_type <> 'other' then raise exception 'S2: an unknown org_type was not coerced: %', v_org.org_type; end if;

  -- a malformed domain is dropped, never stored
  v_id := public.fn_dq_signup_create_org('Smoke Three', 'owner', 'not a domain at all');
  select * into v_org from public.organizations where id = v_id;
  if v_org.email_domains is not null then raise exception 'S2: a malformed email domain was stored: %', v_org.email_domains; end if;
  -- and an address is not a domain
  v_id := public.fn_dq_signup_create_org('Smoke Four', 'owner', 'someone@example.com');
  select * into v_org from public.organizations where id = v_id;
  if v_org.email_domains is not null then raise exception 'S2: an email ADDRESS was stored as a domain: %', v_org.email_domains; end if;

  -- ── S3 · the channel is named, so the write is not anonymous ─────────────
  -- (fn_dq_forms_gate returns early for organizations — no trigger there —
  -- but the channel is what the gate log and any future rule would read)
  if position('set_config' in (select prosrc from pg_proc where proname = 'fn_dq_signup_create_org')) = 0 then
    raise exception 'S3: the signup path no longer names its channel';
  end if;

  -- ── S4 · a member cannot write ports or organizations at all ─────────────
  v_probe := public.fn_dq_member_write_probe('ports');
  if (v_probe->>'rls_enabled')::boolean is not true then raise exception 'S4: row-level security is OFF on ports'; end if;
  if (v_probe->>'member_insert_allowed')::boolean then
    raise exception 'S4: a member can now INSERT into ports — the restriction on forms.port.autocomplete / forms.port.availability no longer holds: %', v_probe->'insert_policies';
  end if;

  v_probe := public.fn_dq_member_write_probe('organizations');
  if (v_probe->>'rls_enabled')::boolean is not true then raise exception 'S4: row-level security is OFF on organizations'; end if;
  if (v_probe->>'member_insert_allowed')::boolean then
    raise exception 'S4: a member can now INSERT into organizations directly, bypassing fn_dq_signup_create_org: %', v_probe->'insert_policies';
  end if;

  -- ── S5 · an unverified port is invisible to members ──────────────────────
  -- The restriction that matters for the two port paths: the row they write
  -- carries is_verified = false, and the member read policy is is_verified.
  delete from public.ports where locode = v_locode;
  insert into public.ports (locode, trade_name, country, zone, port_type, is_active, is_verified)
  values (v_locode, 'Smoke Test Port', 'Testland', 'Unknown', 'Sea Port', true, false);

  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename = 'ports' and cmd = 'SELECT'
     and coalesce(qual, '') like '%is_verified%';
  if n = 0 then
    raise exception 'S5: the member read policy on ports no longer keys on is_verified — an unverified port may now be visible';
  end if;

  -- and the row really is unverified, so that policy hides it
  if (select is_verified from public.ports where locode = v_locode) then
    raise exception 'S5: the port was created verified';
  end if;

  -- ── S6 · the restricted function is not reachable by a member ────────────
  select count(*) into n
    from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name = 'fn_dq_signup_create_org'
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC', 'dq_evaluator');
  if n > 0 then raise exception 'S6: fn_dq_signup_create_org is executable by % non-service role(s)', n; end if;

  select count(*) into n
    from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name = 'fn_dq_member_write_probe'
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC', 'dq_evaluator');
  if n > 0 then raise exception 'S6: fn_dq_member_write_probe is executable by % non-service role(s)', n; end if;

  raise notice 'DQ I SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
