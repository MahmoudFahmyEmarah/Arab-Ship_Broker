-- ════════════════════════════════════════════════════════════════════════
-- PDA · port agency registry and directory (owner ruling O2ALL-009, 18 Oct 2026; Agents phase 1)
--
-- Owner decisions: only ASB-INVITED agencies are listed (A2); agencies will log in and answer quote requests (A1 c —
-- phase 2). An agency is an existing platform ORGANISATION (its staff are its members, so phase 2 reuses accounts,
-- seats and invitations); it becomes a listed agency only through this registry, by an owner-tier admin.
-- organizations.org_type is NOT changed (other modules rely on its six values).
--
--   pda_agencies(org_id)            — the invited agency: display name, website, active | suspended, who invited it
--   pda_port_agents(org_id, port)   — which verified port it attends and which of the nine route services it quotes
--   pda_agency_events               — append-only log of every registry change (who, what, when)
--   All three: RLS on, no API grant.
--
--   pda_admin_upsert_agency(actor, org, payload)                 service_role; owner-tier admin actor (fn_pda_assert_admin_actor)
--   pda_admin_set_port_agent(actor, org, port, services, active) service_role; owner-tier admin actor
--   pda_admin_list_agencies(actor)                               service_role; owner-tier admin actor (console read)
--   list_pda_port_agents(port default null)                      members (signed in + fn_pda_member_entitled): ACTIVE agencies
--                                                                at ACTIVE, verified ports only; no contact details, no
--                                                                internal ids except the agency handle phase 2 requests use
--   get_my_pda_agency()                                          a member of an ACTIVE listed agency: its own listing (null otherwise)
-- Plain SQL. DOWN: supabase/rollback/20261018130000_pda_agencies_down.sql (refuses while listings exist unless confirmed).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create table if not exists public.pda_agencies (
  org_id        uuid primary key references public.organizations(id),
  display_name  text not null check (char_length(btrim(display_name)) between 2 and 200),
  website       text check (website is null or website ~ '^https://[^\s/]+(/[^\s]*)?$'),
  status        text not null default 'active' check (status in ('active', 'suspended')),
  invited_by    uuid not null references public.users(id),
  invited_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.pda_port_agents (
  org_id        uuid not null references public.pda_agencies(org_id),
  port_locode   text not null references public.ports(locode),
  services      text[] not null default '{}'
                check (services <@ array['port_dues','pilotage','towage','mooring','cargo_handling','agency','waste','security','launch']::text[]),
  status        text not null default 'active' check (status in ('active', 'withdrawn')),
  verified_by   uuid not null references public.users(id),
  verified_at   timestamptz not null default now(),
  primary key (org_id, port_locode)
);
create index if not exists pda_port_agents_port_idx on public.pda_port_agents (port_locode) where status = 'active';

create table if not exists public.pda_agency_events (
  id            bigint generated always as identity primary key,
  org_id        uuid not null,
  port_locode   text,
  action        text not null check (action in ('agency_upserted', 'port_set')),
  actor_user_id uuid not null,
  payload       jsonb not null default '{}'::jsonb,
  at            timestamptz not null default now()
);

alter table public.pda_agencies enable row level security;
alter table public.pda_port_agents enable row level security;
alter table public.pda_agency_events enable row level security;
revoke all on table public.pda_agencies, public.pda_port_agents, public.pda_agency_events from public, anon, authenticated, service_role;

create or replace function public.fn_pda_agency_events_append_only()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception 'PDA_IMMUTABLE: the agency registry log is append-only' using errcode = '55000';
end $$;
revoke all on function public.fn_pda_agency_events_append_only() from public, anon, authenticated;
drop trigger if exists pda_agency_events_append_only on public.pda_agency_events;
create trigger pda_agency_events_append_only before update or delete on public.pda_agency_events
  for each row execute function public.fn_pda_agency_events_append_only();

create or replace function public.pda_admin_upsert_agency(p_actor uuid, p_org_id uuid, p_payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare
  v_name text := btrim(coalesce(p_payload->>'displayName', ''));
  v_site text := nullif(btrim(coalesce(p_payload->>'website', '')), '');
  v_status text := coalesce(nullif(p_payload->>'status', ''), 'active');
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  if p_org_id is null or not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'PDA_AGENCY: the organisation does not exist' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 200 then
    raise exception 'PDA_VALIDATION: the agency name must be 2 to 200 characters' using errcode = '22023';
  end if;
  if v_site is not null and v_site !~ '^https://[^\s/]+(/[^\s]*)?$' then
    raise exception 'PDA_VALIDATION: the website must be an https:// address' using errcode = '22023';
  end if;
  if v_status not in ('active', 'suspended') then
    raise exception 'PDA_VALIDATION: status must be active or suspended' using errcode = '22023';
  end if;
  insert into public.pda_agencies (org_id, display_name, website, status, invited_by)
  values (p_org_id, v_name, v_site, v_status, p_actor)
  on conflict (org_id) do update
    set display_name = excluded.display_name, website = excluded.website, status = excluded.status, updated_at = now();
  insert into public.pda_agency_events (org_id, action, actor_user_id, payload)
  values (p_org_id, 'agency_upserted', p_actor, jsonb_build_object('displayName', v_name, 'website', v_site, 'status', v_status));
  return jsonb_build_object('agencyId', p_org_id, 'displayName', v_name, 'status', v_status);
end;
$$;
revoke all on function public.pda_admin_upsert_agency(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pda_admin_upsert_agency(uuid, uuid, jsonb) to service_role;

create or replace function public.pda_admin_set_port_agent(p_actor uuid, p_org_id uuid, p_port_locode text, p_services text[], p_active boolean)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare v_port text := upper(btrim(coalesce(p_port_locode, ''))); v_services text[];
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  if not exists (select 1 from public.pda_agencies a where a.org_id = p_org_id) then
    raise exception 'PDA_AGENCY: invite the agency before listing it at a port' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ports p where p.locode = v_port and p.is_active and p.is_verified) then
    raise exception 'PDA_VALIDATION: the port must be active and verified' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct s order by s), '{}') into v_services from unnest(coalesce(p_services, '{}')) s;
  if not v_services <@ array['port_dues','pilotage','towage','mooring','cargo_handling','agency','waste','security','launch']::text[] then
    raise exception 'PDA_VALIDATION: unknown service in %', v_services using errcode = '22023';
  end if;
  if p_active is null then
    raise exception 'PDA_VALIDATION: say whether the agency attends this port' using errcode = '22023';
  end if;
  insert into public.pda_port_agents (org_id, port_locode, services, status, verified_by)
  values (p_org_id, v_port, v_services, case when p_active then 'active' else 'withdrawn' end, p_actor)
  on conflict (org_id, port_locode) do update
    set services = excluded.services, status = excluded.status, verified_by = excluded.verified_by, verified_at = now();
  insert into public.pda_agency_events (org_id, port_locode, action, actor_user_id, payload)
  values (p_org_id, v_port, 'port_set', p_actor, jsonb_build_object('services', to_jsonb(v_services), 'active', p_active));
  return jsonb_build_object('agencyId', p_org_id, 'portLocode', v_port, 'services', to_jsonb(v_services), 'active', p_active);
end;
$$;
revoke all on function public.pda_admin_set_port_agent(uuid, uuid, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.pda_admin_set_port_agent(uuid, uuid, text, text[], boolean) to service_role;

create or replace function public.pda_admin_list_agencies(p_actor uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_result jsonb;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  select coalesce(jsonb_agg(jsonb_build_object(
    'agencyId', a.org_id, 'displayName', a.display_name, 'website', a.website, 'status', a.status,
    'organisation', o.name, 'invitedAt', a.invited_at, 'updatedAt', a.updated_at,
    'members', (select count(*) from public.organization_members m where m.org_id = a.org_id and m.is_current and m.status = 'active'),
    'ports', coalesce((select jsonb_agg(jsonb_build_object('portLocode', pa.port_locode, 'portName', p.trade_name,
                                                          'services', to_jsonb(pa.services), 'status', pa.status, 'verifiedAt', pa.verified_at)
                                       order by p.trade_name)
                       from public.pda_port_agents pa join public.ports p on p.locode = pa.port_locode
                       where pa.org_id = a.org_id), '[]'::jsonb)
  ) order by a.display_name), '[]'::jsonb) into v_result
  from public.pda_agencies a join public.organizations o on o.id = a.org_id;
  return v_result;
end;
$$;
revoke all on function public.pda_admin_list_agencies(uuid) from public, anon, authenticated;
grant execute on function public.pda_admin_list_agencies(uuid) to service_role;

create or replace function public.list_pda_port_agents(p_port_locode text default null)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_port text := nullif(upper(btrim(coalesce(p_port_locode, ''))), ''); v_result jsonb;
begin
  if public.fn_app_user_id() is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x.item order by x.name), '[]'::jsonb) into v_result
  from (
    select a.display_name as name, jsonb_build_object(
      'agencyId', a.org_id,
      'displayName', a.display_name,
      'website', a.website,
      'ports', (select jsonb_agg(jsonb_build_object('portLocode', pa.port_locode, 'portName', p.trade_name,
                                                    'country', p.country, 'services', to_jsonb(pa.services))
                                 order by p.trade_name)
                from public.pda_port_agents pa join public.ports p on p.locode = pa.port_locode and p.is_active and p.is_verified
                where pa.org_id = a.org_id and pa.status = 'active')
    ) as item
    from public.pda_agencies a
    where a.status = 'active'
      and exists (select 1 from public.pda_port_agents pa join public.ports p on p.locode = pa.port_locode and p.is_active and p.is_verified
                   where pa.org_id = a.org_id and pa.status = 'active' and (v_port is null or pa.port_locode = v_port))
  ) x;
  return v_result;
end;
$$;
revoke all on function public.list_pda_port_agents(text) from public, anon;
grant execute on function public.list_pda_port_agents(text) to authenticated, service_role;

create or replace function public.get_my_pda_agency()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_user uuid := public.fn_app_user_id(); v_result jsonb;
begin
  if v_user is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'agencyId', a.org_id, 'displayName', a.display_name, 'website', a.website,
    'memberRole', m.member_role,
    'ports', coalesce((select jsonb_agg(jsonb_build_object('portLocode', pa.port_locode, 'portName', p.trade_name, 'services', to_jsonb(pa.services))
                                       order by p.trade_name)
                       from public.pda_port_agents pa join public.ports p on p.locode = pa.port_locode
                       where pa.org_id = a.org_id and pa.status = 'active'), '[]'::jsonb)
  ) into v_result
  from public.pda_agencies a
  join public.organization_members m on m.org_id = a.org_id and m.user_id = v_user and m.is_current and m.status = 'active'
  where a.status = 'active'
  order by a.display_name
  limit 1;
  return v_result;
end;
$$;
revoke all on function public.get_my_pda_agency() from public, anon;
grant execute on function public.get_my_pda_agency() to authenticated, service_role;
