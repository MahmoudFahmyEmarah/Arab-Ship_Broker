-- DOWN for the Fuel Bar block 20261003100000 … 20261003110000 (Stream B).
-- Drops every bunker object in reverse dependency order and restores the
-- legacy fuel_prices comment. public.fuel_prices itself was never altered, so
-- its rows are intact. Run only on an isolated database or with the owner's
-- explicit approval. Runs as one transaction (psql -1 / the migration harness).


-- 110000 (functions it replaced are dropped below with their originals)
drop table if exists public.bunker_quote_supersessions;

-- 109000 (functions it replaced are dropped below with their originals)
drop trigger if exists trg_bunker_quote_restore on public.bunker_quotes;
drop function if exists public.fn_bunker_restore_on_unstarted_withdraw();
drop function if exists public.fn_bunker_fuel_index(text, text[], timestamptz, numeric, boolean);
drop function if exists public.fn_bunker_live_prices(timestamptz, numeric);

-- 105000 (functions it replaced are dropped below with their 102000/103000 originals)
drop function if exists public.get_bunker_port_flags(text[]);
drop function if exists public.fn_bunker_command_sha256(jsonb);

-- 104000
comment on table public.fuel_prices is null;

-- 103000
drop function if exists public.admin_bunker_dashboard(uuid);
drop function if exists public.admin_bunker_decide_quote(uuid, uuid, text, text);
drop function if exists public.admin_bunker_override_quote(uuid, uuid, jsonb, text);
drop function if exists public.admin_bunker_set_member(uuid, uuid, uuid, text);
drop function if exists public.admin_bunker_upsert_supplier(uuid, jsonb);
drop function if exists public.supplier_list_my_quotes();
drop function if exists public.supplier_withdraw_quote(uuid, text);
drop function if exists public.supplier_upsert_quotes(jsonb, uuid);
drop function if exists public.fn_bunker_record_quote(uuid, jsonb, text, uuid, boolean, text);
drop function if exists public.fn_bunker_approve_quote(uuid, uuid, text);
drop function if exists public.fn_bunker_member_supplier(uuid, boolean);
drop function if exists public.fn_bunker_assert_admin(uuid, boolean);

-- 102000
drop function if exists public.get_bunker_ticker();
drop function if exists public.get_fuel_price_index(text, text[], timestamptz, numeric);
drop function if exists public.fn_bunker_live_quotes(timestamptz, numeric);
drop function if exists public.fn_bunker_freshness(interval);
drop function if exists public.fn_bunker_normalised_price(numeric, numeric, numeric, numeric);

-- 101000
drop table if exists public.bunker_quote_events;
drop table if exists public.bunker_quotes;
drop table if exists public.bunker_supplier_members;
drop table if exists public.bunker_supplier_ports;
drop table if exists public.bunker_suppliers;
drop function if exists public.fn_bunker_event_immutable();
drop function if exists public.fn_bunker_quote_append_only();

-- 100000
drop table if exists public.bunker_port_flags;
drop table if exists public.fuel_products;

delete from supabase_migrations.schema_migrations
 where version in ('20261003100000', '20261003101000', '20261003102000', '20261003103000', '20261003104000', '20261003105000', '20261003106000', '20261003107000', '20261003108000', '20261003109000', '20261003110000');

