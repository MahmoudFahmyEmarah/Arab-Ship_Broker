-- Exact data fingerprint (Codex C2O-162 P0-3). Read-only (the runner sets default_transaction_read_only). One line per
-- table: its row count and an order-independent digest of every row (md5 of the sorted md5s of each row's text form),
-- so equal lines mean equal rows, not merely equal counts.
--
-- Covered: every ordinary table and partition in public, market_private, fixture_private, auth (users, identities,
-- sessions, refresh tokens, MFA factors and challenges, one-time tokens, flow state, SSO/SAML …), storage, vault and
-- supabase_migrations.
-- Declared exceptions (not "exact restoration", reported as such by the runner):
--   auth.audit_log_entries — Auth appends a durable audit row for every sign-in and admin call; it cannot be undone.
--   sequence positions — an insert advances a sequence and a DOWN or delete never rewinds it (the schema fingerprint
--   still pins every sequence's definition).
--   psql -X -q -At -v ON_ERROR_STOP=1 -f supabase/tests/e2e/data-fingerprint.sql
do $fp$
declare r record; v_rows bigint; v_md5 text; acc text := '';
begin
  for r in
    select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r'
       and n.nspname in ('public', 'market_private', 'fixture_private', 'auth', 'storage', 'vault', 'supabase_migrations')
       and not (n.nspname = 'auth' and c.relname = 'audit_log_entries')
     order by n.nspname, c.relname
  loop
    execute format('select count(*), md5(coalesce(string_agg(h, '''' order by h), '''')) from (select md5(t::text) h from %I.%I t) x',
                   r.nspname, r.relname) into v_rows, v_md5;
    acc := acc || 'data ' || r.nspname || '.' || r.relname || ' rows=' || v_rows || ' md5=' || v_md5 || E'\n';
  end loop;
  perform set_config('e2e.data_fp', acc, false);
end $fp$;
select line from unnest(string_to_array(rtrim(current_setting('e2e.data_fp'), E'\n'), E'\n')) line order by line;
