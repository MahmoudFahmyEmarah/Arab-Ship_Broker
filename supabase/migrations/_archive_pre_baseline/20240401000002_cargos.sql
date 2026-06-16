-- 1. Drop old objects for a clean migration
drop view if exists "public"."cargos_access_view" cascade;
drop table if exists "public"."cargos" cascade;
drop type if exists "public"."cargo_type_enum" cascade;
drop type if exists "public"."imsbc_group" cascade;
drop type if exists "public"."cargo_unit" cascade;
drop type if exists "public"."contact_role" cascade;

-- 2. Create Enums
create type "public"."cargo_type_enum" as enum ('bulk', 'breakbulk');
create type "public"."imsbc_group" as enum ('A', 'B', 'C');
create type "public"."cargo_unit" as enum ('mt', 'cbm', 'units');
create type "public"."contact_role" as enum ('shipper', 'forwarder', 'broker');

-- 3. Create Cargos Table
create table "public"."cargos" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid, -- Foreign key to auth.users
    "cargo_type" public.cargo_type_enum not null,
    "category" text not null,
    "bcsn" text,
    "imsbc_group" public.imsbc_group,
    "is_dangerous_goods" boolean not null default false,
    "quantity_min_mt" numeric(12,2) not null,
    "quantity_max_mt" numeric(12,2) not null,
    "unit" public.cargo_unit not null default 'mt'::public.cargo_unit,
    "stowage_factor" numeric(8,2),
    "load_port" text not null,
    "load_locode" text not null,
    "load_region" text not null,
    "discharge_port" text not null,
    "discharge_locode" text not null,
    "discharge_region" text not null,
    "laycan_from" date not null,
    "laycan_to" date not null,
    "loading_terms" text not null,
    "freight_idea" text,
    "contact_name" text not null,
    "contact_email" text not null,
    "contact_phone" text not null,
    "contact_role" public.contact_role not null,
    "status" text not null default 'IN',
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);

-- 4. Constraints & Indexes
alter table "public"."cargos" add constraint "cargos_pkey" PRIMARY KEY (id);
alter table "public"."cargos" add constraint "cargos_user_id_fkey" 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 5. Enable RLS on the table
alter table "public"."cargos" enable row level security;

-- Table RLS Policies
create policy "Public Select" on "public"."cargos" for select using (true);
create policy "Owner Insert" on "public"."cargos" for insert with check (auth.uid() = user_id OR user_id IS NULL);
create policy "Owner Update" on "public"."cargos" for update using (auth.uid() = user_id);
create policy "Owner Delete" on "public"."cargos" for delete using (auth.uid() = user_id);

-- 6. CREATE THE ACCESS VIEW
create or replace view "public"."cargos_access_view" as
 select
    c.id,
    c.created_at,
    c.cargo_type,
    c.category,
    c.load_region,
    c.discharge_region,
    c.is_dangerous_goods,
    c.imsbc_group,
    c.loading_terms,
    c.status,
    -- Security Logic: Mask sensitive data for guests
    case 
        when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' 
        then c.load_port else 'Restricted' 
    end as load_port,
    case 
        when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' 
        then c.discharge_port else 'Restricted' 
    end as discharge_port,
    case 
        when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' 
        then concat(c.quantity_min_mt, ' - ', c.quantity_max_mt, ' ', c.unit)
        else 'Login for details' 
    end as quantity_range,

    -- Member-Only Fields (Returns NULL if Guest)
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.bcsn else null end as bcsn,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.quantity_min_mt else null end as quantity_min_mt,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.quantity_max_mt else null end as quantity_max_mt,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.unit::text else null end as unit,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.stowage_factor else null end as stowage_factor,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.load_locode else null end as load_locode,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.discharge_locode else null end as discharge_locode,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.laycan_from::text else null end as laycan_from,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.laycan_to::text else null end as laycan_to,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.freight_idea else null end as freight_idea,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.contact_name else null end as contact_name,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.contact_email else null end as contact_email,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.contact_phone else null end as contact_phone,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.contact_role::text else null end as contact_role,

    -- Pass the tier to the frontend for UI logic
    case 
        when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' 
        then 'member'::text else 'guest'::text 
    end as access_tier
   from public.cargos c
  where c.status = 'IN';

-- 7. Grants
grant select on table "public"."cargos_access_view" to anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on table "public"."cargos" to anon, authenticated, service_role;

-- 8. CREATE THE MISSING RPC FUNCTION FOR AUTO-REGISTRATION
CREATE OR REPLACE FUNCTION public.get_or_create_user_profile(
    p_email text,
    p_name text,
    p_role public.user_role,
    p_tier public.access_tier
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user public.users;
    v_auth_uid uuid;
BEGIN
    -- 1. Grab the auth.users ID created by signInWithOtp
    SELECT id INTO v_auth_uid FROM auth.users WHERE email = p_email LIMIT 1;

    IF NOT FOUND THEN
       RAISE EXCEPTION 'Auth user not found for email %', p_email;
    END IF;

    -- 2. Check if the public profile already exists
    SELECT * INTO v_user FROM public.users WHERE email = p_email;

    -- 3. Create or update the profile
    IF NOT FOUND THEN
        INSERT INTO public.users (supabase_user_id, email, name, role, access_tier)
        VALUES (v_auth_uid, p_email, p_name, p_role, p_tier)
        RETURNING * INTO v_user;
    ELSE
        UPDATE public.users
        SET access_tier = p_tier, role = p_role
        WHERE id = v_user.id
        RETURNING * INTO v_user;
    END IF;

    RETURN v_user;
END;
$$;