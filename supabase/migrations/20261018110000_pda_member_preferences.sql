-- ════════════════════════════════════════════════════════════════════════
-- PDA · member preferences for the Setup tab (owner ruling O2ALL-008, 18 Oct 2026; increment D)
--
-- The reference design kept these in browser storage, which is not authorised; here they are one governed row per
-- member. A preference only changes how the page is SHOWN — it never changes a figure and never hides where a figure
-- came from (reference pda-est-setup: "Preferences are personal … they never change a figure").
--   * density       'compact' | 'comfortable' — the row height of the estimate (default compact, as today);
--   * start_tab     'estimate' | 'ports'       — the tab the page opens on (default estimate).
--
-- public.pda_member_preferences: RLS on, no direct grant to any API role (members use the two RPCs below).
--   get_my_pda_preferences()               → {density, startTab, saved} (defaults when no row)
--   set_my_pda_preferences(density, tab)   → upsert of the CALLER's own row only; validated; returns the saved values
-- Both: signed in and fn_pda_member_entitled() (same gate as the estimator); authenticated + service_role.
-- The row follows the member row (on delete cascade): preferences are not audit records (contrast H1).
-- Plain SQL. DOWN: supabase/rollback/20261018110000_pda_member_preferences_down.sql (refuses while rows exist unless
-- the caller confirms in the same transaction).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create table if not exists public.pda_member_preferences (
  user_id     uuid primary key references public.users(id) on delete cascade,
  density     text not null default 'compact' check (density in ('compact', 'comfortable')),
  start_tab   text not null default 'estimate' check (start_tab in ('estimate', 'ports')),
  updated_at  timestamptz not null default now()
);
alter table public.pda_member_preferences enable row level security;
revoke all on table public.pda_member_preferences from public, anon, authenticated, service_role;
comment on table public.pda_member_preferences is
  'PDA Setup tab (O2ALL-008): how the estimator is shown to one member. Never changes a figure. Read/write only through get_my_pda_preferences / set_my_pda_preferences.';

create or replace function public.get_my_pda_preferences()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_user uuid := public.fn_app_user_id(); r public.pda_member_preferences;
begin
  if v_user is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  select * into r from public.pda_member_preferences p where p.user_id = v_user;
  return jsonb_build_object(
    'density', coalesce(r.density, 'compact'),
    'startTab', coalesce(r.start_tab, 'estimate'),
    'saved', r.user_id is not null
  );
end;
$$;
revoke all on function public.get_my_pda_preferences() from public, anon;
grant execute on function public.get_my_pda_preferences() to authenticated, service_role;

create or replace function public.set_my_pda_preferences(p_density text, p_start_tab text)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare v_user uuid := public.fn_app_user_id();
begin
  if v_user is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  if p_density is null or p_density not in ('compact', 'comfortable') then
    raise exception 'PDA_VALIDATION: row height must be compact or comfortable' using errcode = '22023';
  end if;
  if p_start_tab is null or p_start_tab not in ('estimate', 'ports') then
    raise exception 'PDA_VALIDATION: the start tab must be estimate or ports' using errcode = '22023';
  end if;
  insert into public.pda_member_preferences (user_id, density, start_tab, updated_at)
  values (v_user, p_density, p_start_tab, now())
  on conflict (user_id) do update
    set density = excluded.density, start_tab = excluded.start_tab, updated_at = excluded.updated_at;
  return jsonb_build_object('density', p_density, 'startTab', p_start_tab, 'saved', true);
end;
$$;
revoke all on function public.set_my_pda_preferences(text, text) from public, anon;
grant execute on function public.set_my_pda_preferences(text, text) to authenticated, service_role;
