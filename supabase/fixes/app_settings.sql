-- app_settings: global platform key/value flags (admin-managed).
-- Apply this against the LIVE database. The repo baseline migration already
-- declares the same table; this file mirrors it so the live schema (which
-- diverges from the migrations) gets the table without a full rebuild.
--
-- The dashboard reads the "beta_mode" flag: when true, non-admin members are
-- limited to the Dashboard and every other page shows a "coming soon" overlay.

create table if not exists public."app_settings" (
  "key" text not null,
  "value" jsonb default 'null'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null,
  primary key ("key")
);

-- Seed the beta-mode flag (off by default; existing value is preserved).
insert into public."app_settings" ("key", "value")
values ('beta_mode', 'false'::jsonb)
on conflict ("key") do nothing;

alter table public."app_settings" enable row level security;

-- Any authenticated viewer may READ flags (the dashboard reads beta_mode).
drop policy if exists "app_settings: read" on public."app_settings";
create policy "app_settings: read" on public."app_settings"
  as permissive for select to public using (true);

-- Only admins may WRITE. The admin UI writes with the service-role key (which
-- bypasses RLS); this policy is defense-in-depth for any session-scoped access.
drop policy if exists "app_settings: admin write" on public."app_settings";
create policy "app_settings: admin write" on public."app_settings"
  as permissive for all to public
  using (public.fn_is_admin()) with check (public.fn_is_admin());
