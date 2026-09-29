-- Restore the public.users authority boundary that existed immediately before
-- 20260923330000.  This is a disaster-recovery artefact; never run it as an
-- ordinary application operation because it deliberately restores the old,
-- broad member update policy.

drop trigger if exists trg_users_guard_profile_update on public.users;
drop function if exists public.fn_guard_user_profile_update();

drop trigger if exists trg_users_sync_admin_auth_claim on public.users;
drop function if exists public.fn_sync_admin_auth_claim();

create or replace function public.fn_is_admin()
returns boolean
language sql
stable
as $function$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    FALSE
  );
$function$;

-- 20260910142000 hardened this predicate for policy evaluation by the
-- dq_evaluator role. CREATE OR REPLACE preserves neither proconfig nor the
-- SECURITY DEFINER flag, so restore both attributes from the pre-330000
-- baseline explicitly.
alter function public.fn_is_admin() security definer;
alter function public.fn_is_admin() set search_path = '';

drop policy if exists "users: own profile read" on public.users;
drop policy if exists "users: own profile update" on public.users;
drop policy if exists "users: admin all" on public.users;
drop policy if exists "users: own row" on public.users;

create policy "users: admin all"
on public.users as permissive for all to public
using (public.fn_is_admin());

create policy "users: own row"
on public.users as permissive for all to public
using (id = auth.uid());

grant delete, insert, references, select, trigger, truncate, update
  on table public.users to anon, authenticated;
