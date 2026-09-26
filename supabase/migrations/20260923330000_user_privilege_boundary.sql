-- Close the public.users privilege-escalation path.
--
-- `public.users` is the application profile, not the source of truth for an
-- administrator session.  A member may edit the small, explicit profile
-- allow-list below; the service role owns every access-control field.  Admin
-- authority is additionally tied to auth.users.raw_app_meta_data, which a
-- browser client cannot forge.

create or replace function public.fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and exists (
      select 1
      from public.users u
      where (u.supabase_user_id = auth.uid() or u.id = auth.uid())
        and lower(coalesce(u.role, '')) = 'admin'
        and u.is_active
    ),
    false
  );
$function$;

-- Keep the Auth claim and the application row synchronized for service-owned
-- promotions/demotions.  A stale access token is still denied because
-- fn_is_admin also checks the current public.users role and active state.
create or replace function public.fn_sync_admin_auth_claim()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_auth_id uuid := coalesce(new.supabase_user_id, new.id);
begin
  if v_auth_id is null then
    return new;
  end if;

  update auth.users
     set raw_app_meta_data = case
       when lower(coalesce(new.role, '')) = 'admin' then
         jsonb_set(
           coalesce(raw_app_meta_data, '{}'::jsonb),
           '{role}',
           to_jsonb('admin'::text),
           true
         )
       else coalesce(raw_app_meta_data, '{}'::jsonb) - 'role'
     end
   where id = v_auth_id;

  return new;
end;
$function$;

drop trigger if exists trg_users_sync_admin_auth_claim on public.users;
create trigger trg_users_sync_admin_auth_claim
after insert or update of role, supabase_user_id on public.users
for each row execute function public.fn_sync_admin_auth_claim();

-- Backfill existing administrators so their next refreshed session has the
-- durable app_metadata claim.  Also remove a stale admin claim from a row that
-- is no longer an active administrator.
update auth.users au
   set raw_app_meta_data = case
     when lower(coalesce(u.role, '')) = 'admin' and u.is_active then
       jsonb_set(
         coalesce(au.raw_app_meta_data, '{}'::jsonb),
         '{role}',
         to_jsonb('admin'::text),
         true
       )
     else coalesce(au.raw_app_meta_data, '{}'::jsonb) - 'role'
   end
  from public.users u
 where au.id = coalesce(u.supabase_user_id, u.id)
   and (
     au.raw_app_meta_data is distinct from case
       when lower(coalesce(u.role, '')) = 'admin' and u.is_active then
         jsonb_set(
           coalesce(au.raw_app_meta_data, '{}'::jsonb),
           '{role}',
           to_jsonb('admin'::text),
           true
         )
       else coalesce(au.raw_app_meta_data, '{}'::jsonb) - 'role'
     end
   );

create or replace function public.fn_guard_user_profile_update()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  -- Service-owned commands (admin provisioning, data-quality repair and
  -- erasure) remain possible.  Browser-originated authenticated requests do
  -- not get this bypass.
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  if old.id is distinct from public.fn_app_user_id() then
    raise exception 'ASB_USER_PROFILE: a member may update only their own profile'
      using errcode = '42501';
  end if;

  -- The allow-list is deliberate: full_name, company and phone are profile
  -- data.  Role, plan, active state, trust, strikes, notes, IDs, email and
  -- every future column are service-owned unless expressly added here.
  if (to_jsonb(new) - array['full_name', 'company', 'phone', 'updated_at'])
       is distinct from
     (to_jsonb(old) - array['full_name', 'company', 'phone', 'updated_at']) then
    raise exception 'ASB_USER_PRIVILEGE: access-control fields are service-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_users_guard_profile_update on public.users;
create trigger trg_users_guard_profile_update
before update on public.users
for each row execute function public.fn_guard_user_profile_update();

-- Replace the broad FOR ALL policy and broad grants.  Client access is now
-- limited to reading and updating its own profile row; RLS has an explicit
-- WITH CHECK as well as the trigger's column-level allow-list.
drop policy if exists "users: own row" on public.users;
drop policy if exists "users: admin all" on public.users;
drop policy if exists "users: own profile read" on public.users;
drop policy if exists "users: own profile update" on public.users;

create policy "users: own profile read"
on public.users for select to authenticated
using (id = public.fn_app_user_id());

create policy "users: own profile update"
on public.users for update to authenticated
using (id = public.fn_app_user_id())
with check (id = public.fn_app_user_id());

create policy "users: admin all"
on public.users for all to authenticated
using (public.fn_is_admin())
with check (public.fn_is_admin());

revoke all on table public.users from anon, authenticated;
grant select, update on table public.users to authenticated;
