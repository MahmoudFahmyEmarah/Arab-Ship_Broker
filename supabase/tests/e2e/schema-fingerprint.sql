-- Exact schema fingerprint of the application schemas (Codex C2O-162 P0-2). Read-only; one line per catalog object,
-- sorted, so two runs can be diffed line by line and digested with md5 of the whole output. It extends the migration
-- harness's classes (scripts/migration-harness.sh) to every class a PDA migration or DOWN can change:
--   schemas (owner, ACL) · relations of every kind (owner, RLS enabled + forced, ACL) · columns (type with modifiers,
--   not null, default, identity, generated expression, column ACL) · views and materialized views (definition) ·
--   functions and procedures (body, args, result, owner, volatility, security, config, ACL) · indexes · constraints ·
--   policies (command, permissive, roles, qual, check) · triggers (definition AND enabled state) · types (enum labels,
--   domains with base type and constraints, composites with attributes) · sequences (type, bounds, increment, owner
--   column, ACL) · installed extensions with versions.
-- Schemas: public, market_private, fixture_private (the three the application owns; Supabase-managed schemas excluded).
--   psql -X -q -At -v ON_ERROR_STOP=1 -f supabase/tests/e2e/schema-fingerprint.sql
with sch as (select oid, nspname from pg_namespace where nspname in ('public', 'market_private', 'fixture_private'))
select fp from (
  select 'schema ' || n.nspname || ' owner=' || pg_get_userbyid(n.nspowner) || ' acl=' || coalesce(n.nspacl::text, '') as fp
    from pg_namespace n join sch on sch.oid = n.oid
  union all
  select 'rel ' || s.nspname || '.' || c.relname || ' kind=' || c.relkind::text || ' owner=' || pg_get_userbyid(c.relowner)
         || ' rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text || ' persist=' || c.relpersistence::text
         || ' acl=' || coalesce(c.relacl::text, '')
    from pg_class c join sch s on s.oid = c.relnamespace where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  union all
  select 'col ' || s.nspname || '.' || c.relname || '.' || a.attname || ' #' || a.attnum || ' ' || format_type(a.atttypid, a.atttypmod)
         || ' notnull=' || a.attnotnull::text || ' identity=' || a.attidentity::text || ' generated=' || a.attgenerated::text
         || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' collation=' || coalesce(a.attcollation::regcollation::text, '')
         || ' acl=' || coalesce(a.attacl::text, '')
    from pg_attribute a join pg_class c on c.oid = a.attrelid join sch s on s.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f')
  union all
  select 'view ' || s.nspname || '.' || c.relname || ' ' || md5(pg_get_viewdef(c.oid, true))
    from pg_class c join sch s on s.oid = c.relnamespace where c.relkind in ('v', 'm')
  union all
  select 'func ' || s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') kind=' || p.prokind::text
         || ' returns=' || coalesce(pg_get_function_result(p.oid), '') || ' body=' || md5(case when p.prokind = 'a' then p.proname else pg_get_functiondef(p.oid) end)
         || ' owner=' || pg_get_userbyid(p.proowner) || ' vol=' || p.provolatile::text || ' definer=' || p.prosecdef::text
         || ' leak=' || p.proleakproof::text || ' strict=' || p.proisstrict::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '')
         || ' acl=' || coalesce(p.proacl::text, '')
    from pg_proc p join sch s on s.oid = p.pronamespace
  union all
  select 'index ' || s.nspname || '.' || i.relname || ' ' || md5(pg_get_indexdef(i.oid))
    from pg_index x join pg_class i on i.oid = x.indexrelid join sch s on s.oid = i.relnamespace
  union all
  select 'constraint ' || co.conrelid::regclass::text || '/' || coalesce(co.contypid::regtype::text, '') || '.' || co.conname
         || ' type=' || co.contype::text || ' deferrable=' || co.condeferrable::text || ' validated=' || co.convalidated::text
         || ' ' || md5(pg_get_constraintdef(co.oid))
    from pg_constraint co join sch s on s.oid = co.connamespace
  union all
  select 'policy ' || s.nspname || '.' || c.relname || '.' || po.polname || ' cmd=' || po.polcmd::text || ' permissive=' || po.polpermissive::text
         || ' roles=' || coalesce((select string_agg(case when r = 0 then 'public' else pg_get_userbyid(r) end, ',' order by 1) from unnest(po.polroles) r), '')
         || ' qual=' || md5(coalesce(pg_get_expr(po.polqual, po.polrelid), '')) || ' check=' || md5(coalesce(pg_get_expr(po.polwithcheck, po.polrelid), ''))
    from pg_policy po join pg_class c on c.oid = po.polrelid join sch s on s.oid = c.relnamespace
  union all
  select 'trigger ' || s.nspname || '.' || c.relname || '.' || t.tgname || ' enabled=' || t.tgenabled::text || ' ' || md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join sch s on s.oid = c.relnamespace where not t.tgisinternal
  union all
  select 'enum ' || s.nspname || '.' || t.typname || ' ' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join sch s on s.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid group by s.nspname, t.typname
  union all
  select 'domain ' || s.nspname || '.' || t.typname || ' base=' || format_type(t.typbasetype, t.typtypmod) || ' notnull=' || t.typnotnull::text
         || ' default=' || coalesce(t.typdefault, '') || ' owner=' || pg_get_userbyid(t.typowner) || ' acl=' || coalesce(t.typacl::text, '')
    from pg_type t join sch s on s.oid = t.typnamespace where t.typtype = 'd'
  union all
  select 'composite ' || s.nspname || '.' || t.typname || ' ' || string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
    from pg_type t join sch s on s.oid = t.typnamespace join pg_class c on c.oid = t.typrelid and c.relkind = 'c'
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped group by s.nspname, t.typname
  union all
  select 'sequence ' || s.nspname || '.' || c.relname || ' type=' || format_type(q.seqtypid, null) || ' start=' || q.seqstart || ' inc=' || q.seqincrement
         || ' min=' || q.seqmin || ' max=' || q.seqmax || ' cycle=' || q.seqcycle::text
         || ' owned=' || coalesce((select dc.relname || '.' || da.attname from pg_depend dp join pg_class dc on dc.oid = dp.refobjid
                                     join pg_attribute da on da.attrelid = dp.refobjid and da.attnum = dp.refobjsubid
                                    where dp.objid = c.oid and dp.classid = 'pg_class'::regclass and dp.deptype in ('a', 'i') limit 1), '')
    from pg_sequence q join pg_class c on c.oid = q.seqrelid join sch s on s.oid = c.relnamespace
  union all
  select 'extension ' || e.extname || ' ' || e.extversion || ' schema=' || e.extnamespace::regnamespace::text from pg_extension e
) f order by fp;
