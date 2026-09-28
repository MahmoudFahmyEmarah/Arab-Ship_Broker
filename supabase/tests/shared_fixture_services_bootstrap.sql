-- Minimal disposable baseline for the shared Fixture-services harness.
-- Cluster roles (anon/authenticated/service_role) already exist in the local
-- Supabase container. This file deliberately avoids environment extensions.

create schema auth;
create schema storage;

create table auth.users (
  id uuid primary key,
  email text,
  aud text,
  role text
);

create table public.users (
  id uuid primary key,
  supabase_user_id uuid unique,
  email text not null,
  full_name text,
  role text,
  subscription_tier text,
  is_active boolean not null default true
);

create or replace function public.fn_app_user_id()
returns uuid
language sql
stable
set search_path to ''
as $$
  select u.id
    from public.users u
   where u.supabase_user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
   limit 1;
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null default ''
);
