-- Data Quality · workstream I — the restricted write paths (21 Sep 2026)
--
-- The enforcement register (lib/dq/policy.ts) used to carry eight paths marked
-- "ungated": declared, so they could not hide, but unjudged. Three of them
-- published live records and are now gated strictly in the application
-- (Admin → Cargo status, Admin → Vessel positions status, the vessel's own
-- particulars). Two more publish reference data and are gated the same way
-- (Admin → Ports, Admin → Commodities). This migration deals with the rest,
-- where the honest answer is not "gate it" but "limit what the path can do at
-- all" — and then make that limit structural rather than a comment.
--
--   fn_dq_signup_create_org   member signup may create an organisation
--                             carrying a NAME, a TYPE and an EMAIL DOMAIN.
--                             Nothing else. The function has no parameter for
--                             a subscription tier, an IMO, a fleet count or a
--                             link, so no future edit to the signup code can
--                             set one: the signature IS the policy.
--
--   fn_dq_member_write_probe  a read-only witness the test suites use to
--                             assert what an authenticated non-admin can
--                             actually write. The member port and signup
--                             paths were recorded as ungated write paths; in
--                             fact `ports` and `organizations` carry no
--                             member INSERT policy at all (only fn_is_admin()),
--                             so those two paths are unreachable for a member.
--                             That is worth a test rather than a sentence,
--                             because the day somebody adds a permissive
--                             policy the test is what notices.
--
-- Nothing here changes an existing object. Both functions are new, both are
-- service-role only, both validate their inputs, and the DOWN file drops them.

-- ── 1 · signup may create an organisation, and only these three fields ─────
create or replace function public.fn_dq_signup_create_org(
  p_name         text,
  p_org_type     text,
  p_email_domain text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_name   text;
  v_type   text;
  v_domain text;
  v_id     uuid;
begin
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'fn_dq_signup_create_org: a company name is required' using errcode = '22023';
  end if;
  if length(v_name) > 200 then
    raise exception 'fn_dq_signup_create_org: the company name is longer than 200 characters' using errcode = '22023';
  end if;

  -- the same six values organizations_org_type_check allows; an unknown
  -- declared role becomes 'other' rather than failing a member's signup
  v_type := lower(btrim(coalesce(p_org_type, '')));
  if v_type not in ('owner', 'charterer', 'broker', 'operator', 'manager', 'other') then
    v_type := 'other';
  end if;

  -- a domain, not an address, and not a list
  v_domain := lower(btrim(coalesce(p_email_domain, '')));
  v_domain := nullif(v_domain, '');
  if v_domain is not null and v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    v_domain := null;   -- unusable, so not recorded; the admin can link later
  end if;

  perform set_config('dq.channel', 'signup', true);
  insert into public.organizations (name, org_type, email_domains)
  values (v_name, v_type, case when v_domain is null then null else array[v_domain] end)
  returning id into v_id;

  return v_id;
end $$;

comment on function public.fn_dq_signup_create_org(text, text, text) is
  'Member signup creates an organisation profile: name, type and one email domain, and nothing else. The signature is the limited policy — there is no way through this path to set a subscription tier, an IMO, fleet counts or link fields. Channel "signup". Restricted path forms.signup.org in lib/dq/policy.ts.';

revoke all on function public.fn_dq_signup_create_org(text, text, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_signup_create_org(text, text, text) to service_role;

-- ── 2 · what can a member actually write? ──────────────────────────────────
-- Answers the question behaviourally, for one table, without writing anything:
-- it reports the row-level-security policies that would admit an INSERT by the
-- `authenticated` role. A restricted path's test asserts against this rather
-- than against the shape of the application code.
create or replace function public.fn_dq_member_write_probe(p_table text)
 returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'table', p_table,
    'rls_enabled', coalesce((select c.relrowsecurity from pg_class c
                              join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname = 'public' and c.relname = p_table), false),
    'insert_policies', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.policyname, 'cmd', p.cmd, 'roles', p.roles, 'check', p.with_check) order by p.policyname)
        from pg_policies p
       where p.schemaname = 'public' and p.tablename = p_table
         and p.cmd in ('INSERT', 'ALL')), '[]'::jsonb),
    -- a policy an ordinary member could satisfy: one that admits PUBLIC or
    -- `authenticated` and does not require fn_is_admin()
    'member_insert_allowed', coalesce((
      select bool_or(
               ('authenticated' = any (p.roles) or 'public' = any (p.roles))
               and coalesce(p.with_check, p.qual, 'true') not like '%fn_is_admin()%')
        from pg_policies p
       where p.schemaname = 'public' and p.tablename = p_table
         and p.cmd in ('INSERT', 'ALL')), false)
  );
$$;

comment on function public.fn_dq_member_write_probe(text) is
  'Read-only: reports whether an authenticated non-admin member could INSERT into a table, from the row-level-security policies themselves. Used by the restricted-path tests so a permissive policy added later is caught by a failing test rather than by an audit.';

revoke all on function public.fn_dq_member_write_probe(text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_member_write_probe(text) to service_role;
