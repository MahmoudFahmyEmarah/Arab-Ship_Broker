-- 1. Create Types (Updated with v2 roles and access tiers)
drop type if exists "public"."user_role" cascade;
create type "public"."user_role" as enum ('admin', 'cargo_owner', 'vessel_owner', 'broker');

drop type if exists "public"."access_tier" cascade;
create type "public"."access_tier" as enum ('guest', 'member');

drop type if exists "public"."access_granted_by" cascade;
create type "public"."access_granted_by" as enum ('self_submit', 'manual_approval', 'subscription');

-- 2. Create Table (Updated with v2 fields)
create table "public"."users" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "name" text not null,
    "email" text not null,
    "role" public.user_role not null default 'cargo_owner'::public.user_role,
    "supabase_user_id" uuid not null,
    
    -- New v2 Business Model Fields
    "access_tier" public.access_tier not null default 'guest'::public.access_tier,
    "access_granted_by" public.access_granted_by,
    "access_granted_at" timestamp with time zone,
    "active" boolean not null default true,
    "notes" text
);

-- 3. Enable RLS
alter table "public"."users" enable row level security;

-- ==============================================================================
-- 4. ROW LEVEL SECURITY POLICIES
-- ==============================================================================

-- Users can only view their own profile
create policy "Users can view own data" 
on "public"."users" 
for select 
using (auth.uid() = supabase_user_id);

-- Users can only update their own profile
create policy "Users can update own data" 
on "public"."users" 
for update 
using (auth.uid() = supabase_user_id);

-- Allow users to insert their own profile during registration
create policy "Users can insert own data" 
on "public"."users" 
for insert 
with check (auth.uid() = supabase_user_id);

-- (Optional) If you have an admin dashboard, you would add a policy like this:
-- create policy "Admins can view all users" on "public"."users" for select using ((select role from users where supabase_user_id = auth.uid()) = 'admin');

-- ==============================================================================
-- 5. Indexes and Constraints
-- ==============================================================================
CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);
CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);
CREATE UNIQUE INDEX users_supabase_user_id_key ON public.users USING btree (supabase_user_id);

alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";
alter table "public"."users" add constraint "users_email_key" UNIQUE using index "users_email_key";

alter table "public"."users" add constraint "users_supabase_user_id_fkey" FOREIGN KEY (supabase_user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;
alter table "public"."users" validate constraint "users_supabase_user_id_fkey";
alter table "public"."users" add constraint "users_supabase_user_id_key" UNIQUE using index "users_supabase_user_id_key";

-- ==============================================================================
-- 6. Grants
-- ==============================================================================
grant delete on table "public"."users" to "anon";
grant insert on table "public"."users" to "anon";
grant references on table "public"."users" to "anon";
grant select on table "public"."users" to "anon";
grant trigger on table "public"."users" to "anon";
grant truncate on table "public"."users" to "anon";
grant update on table "public"."users" to "anon";

grant delete on table "public"."users" to "authenticated";
grant insert on table "public"."users" to "authenticated";
grant references on table "public"."users" to "authenticated";
grant select on table "public"."users" to "authenticated";
grant trigger on table "public"."users" to "authenticated";
grant truncate on table "public"."users" to "authenticated";
grant update on table "public"."users" to "authenticated";

grant delete on table "public"."users" to "postgres";
grant insert on table "public"."users" to "postgres";
grant references on table "public"."users" to "postgres";
grant select on table "public"."users" to "postgres";
grant trigger on table "public"."users" to "postgres";
grant truncate on table "public"."users" to "postgres";
grant update on table "public"."users" to "postgres";

grant delete on table "public"."users" to "service_role";
grant insert on table "public"."users" to "service_role";
grant references on table "public"."users" to "service_role";
grant select on table "public"."users" to "service_role";
grant trigger on table "public"."users" to "service_role";
grant truncate on table "public"."users" to "service_role";
grant update on table "public"."users" to "service_role";