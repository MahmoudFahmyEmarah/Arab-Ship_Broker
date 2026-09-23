-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · phase 5 — scale (18 Sep 2026)
--
-- Trigram indexes for the Database Preview search: every `%term%` search
-- over the preview tables' search columns (lib/sync/preview.ts) ran without
-- an index. One GIN trigram index per text column, created only where the
-- column exists and is text-typed, so the migration is safe against the
-- preview spec drifting from the schema. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm with schema extensions;

do $$
declare
  spec text[][] := array[
    ['cargo_listings', 'ref'], ['cargo_listings', 'commodity_name'], ['cargo_listings', 'load_port_name'], ['cargo_listings', 'disch_port_name'], ['cargo_listings', 'broker'],
    ['ports', 'locode'], ['ports', 'trade_name'], ['ports', 'country'],
    ['vessels', 'imo_number'], ['vessels', 'vessel_name'], ['vessels', 'flag'], ['vessels', 'owner_company'],
    ['flag_states', 'name'], ['flag_states', 'iso2'], ['flag_states', 'category'],
    ['organizations', 'name'], ['organizations', 'country'], ['organizations', 'desk_email'],
    ['commodities', 'canonical_name'], ['commodities', 'category_label'],
    ['market_names', 'market_name'], ['market_names', 'code'], ['market_names', 'group_or_cat'],
    ['grain_list', 'market_name'], ['grain_list', 'family'],
    ['imsbc_codes', 'bcsn'], ['imsbc_codes', 'imsbc_group'], ['imsbc_codes', 'un_number'],
    ['sync_staged_row', 'business_key']
  ];
  i int; t text; c text; ix text;
begin
  for i in 1 .. array_length(spec, 1) loop
    t := spec[i][1]; c := spec[i][2];
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = c
         and data_type in ('text', 'character varying', 'character')
    ) then
      ix := format('idx_trgm_%s_%s', t, c);
      if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = ix) then
        execute format('create index %I on public.%I using gin (%I extensions.gin_trgm_ops)', ix, t, c);
      end if;
    end if;
  end loop;
end $$;
