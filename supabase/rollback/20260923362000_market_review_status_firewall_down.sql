-- DOWN for 20260923362000_market_review_status_firewall.sql.

drop function if exists public.list_my_review_statuses(integer);

do $restore_review_view$
declare
  v_definition text;
  v_reloptions text[];
  v_options text;
begin
  if to_regclass('market_private.review_view_snapshot') is null then
    raise exception 'MARKET_ROLLBACK: review view snapshot is missing';
  end if;

  select definition, reloptions
    into v_definition, v_reloptions
    from market_private.review_view_snapshot
   where view_name = 'v_admin_queue_detail';
  if v_definition is null then
    raise exception 'MARKET_ROLLBACK: v_admin_queue_detail definition is missing';
  end if;

  execute format(
    'create or replace view public.v_admin_queue_detail as %s',
    v_definition
  );
  execute 'alter view public.v_admin_queue_detail reset '
          || '(check_option, security_barrier, security_invoker)';

  select string_agg(
           format(
             '%I = %L',
             split_part(option_text, '=', 1),
             substr(option_text, strpos(option_text, '=') + 1)
           ),
           ', ' order by option_ordinality
         )
    into v_options
    from unnest(v_reloptions) with ordinality
      as saved_option(option_text, option_ordinality);
  if v_options is not null then
    execute 'alter view public.v_admin_queue_detail set (' || v_options || ')';
  end if;
end;
$restore_review_view$;

do $drop_review_policies$
declare
  r record;
begin
  for r in
    select p.polname
      from pg_catalog.pg_policy p
     where p.polrelid = 'public.review_queue'::regclass
     order by p.polname
  loop
    execute format(
      'drop policy if exists %I on public.review_queue', r.polname
    );
  end loop;
end;
$drop_review_policies$;

do $restore_review_policies$
declare
  r record;
  v_command text;
  v_roles text;
  v_sql text;
begin
  if to_regclass('market_private.review_policy_snapshot') is null then
    raise exception 'MARKET_ROLLBACK: review policy snapshot is missing';
  end if;

  for r in
    select * from market_private.review_policy_snapshot order by policy_name
  loop
    v_command := case r.command_code
      when 'r' then 'select'
      when 'a' then 'insert'
      when 'w' then 'update'
      when 'd' then 'delete'
      when '*' then 'all'
      else null
    end;
    if v_command is null then
      raise exception 'MARKET_ROLLBACK: unsupported review policy command %',
        r.command_code;
    end if;

    select string_agg(
             case when role_name = 'PUBLIC' then 'public'
                  else format('%I', role_name) end,
             ', ' order by role_ordinality
           )
      into v_roles
      from unnest(r.role_names) with ordinality
        as restored_role(role_name, role_ordinality);

    v_sql := format(
      'create policy %I on public.review_queue as %s for %s to %s',
      r.policy_name,
      case when r.is_permissive then 'permissive' else 'restrictive' end,
      v_command,
      v_roles
    );
    if r.using_expression is not null then
      v_sql := v_sql || format(' using (%s)', r.using_expression);
    end if;
    if r.check_expression is not null then
      v_sql := v_sql || format(' with check (%s)', r.check_expression);
    end if;
    execute v_sql;
  end loop;
end;
$restore_review_policies$;

do $clear_review_acl$
declare
  r record;
begin
  revoke all on table public.review_queue
    from public, anon, authenticated, service_role;
  if to_regclass('public.v_admin_queue_detail') is not null then
    revoke all on table public.v_admin_queue_detail
      from public, anon, authenticated, service_role;
  end if;
  for r in
    select c.relname, a.attname
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any (array['review_queue', 'v_admin_queue_detail'])
       and a.attnum > 0
       and not a.attisdropped
  loop
    execute format(
      'revoke all (%I) on table public.%I from public, anon, authenticated, service_role',
      r.attname, r.relname
    );
  end loop;
end;
$clear_review_acl$;

do $restore_review_acl$
declare
  r record;
  v_grantee text;
  v_grant_option text;
begin
  if to_regclass('market_private.review_relation_acl_snapshot') is null then
    raise exception 'MARKET_ROLLBACK: review relation ACL snapshot is missing';
  end if;

  for r in
    select relation_name, grantor, grantee, privilege_type, is_grantable
      from market_private.review_relation_acl_snapshot
     where grantee = any (array['PUBLIC', 'anon', 'authenticated', 'service_role'])
     order by relation_name, grantor, grantee, privilege_type
  loop
    if to_regclass('public.' || r.relation_name) is not null then
      v_grantee := case
        when r.grantee = 'PUBLIC' then 'public'
        else format('%I', r.grantee)
      end;
      v_grant_option := case
        when r.is_grantable then ' with grant option'
        else ''
      end;
      begin
        execute format('set local role %I', r.grantor);
        execute format(
          'grant %s on table public.%I to %s%s',
          r.privilege_type, r.relation_name, v_grantee, v_grant_option
        );
        reset role;
      exception when others then
        reset role;
        raise;
      end;
    end if;
  end loop;
end;
$restore_review_acl$;

do $restore_review_column_acl$
declare
  r record;
  v_grantee text;
  v_grant_option text;
begin
  if to_regclass('market_private.review_column_acl_snapshot') is null then
    raise exception 'MARKET_ROLLBACK: review column ACL snapshot is missing';
  end if;

  for r in
    select relation_name, column_name, grantor, grantee,
           privilege_type, is_grantable
      from market_private.review_column_acl_snapshot
     where grantee = any (array['PUBLIC', 'anon', 'authenticated', 'service_role'])
     order by relation_name, column_name, grantor, grantee, privilege_type
  loop
    if to_regclass('public.' || r.relation_name) is not null then
      v_grantee := case
        when r.grantee = 'PUBLIC' then 'public'
        else format('%I', r.grantee)
      end;
      v_grant_option := case
        when r.is_grantable then ' with grant option'
        else ''
      end;
      begin
        execute format('set local role %I', r.grantor);
        execute format(
          'grant %s (%I) on table public.%I to %s%s',
          r.privilege_type, r.column_name, r.relation_name,
          v_grantee, v_grant_option
        );
        reset role;
      exception when others then
        reset role;
        raise;
      end;
    end if;
  end loop;
end;
$restore_review_column_acl$;

drop table market_private.review_relation_acl_snapshot;
drop table market_private.review_column_acl_snapshot;
drop table market_private.review_policy_snapshot;
drop table market_private.review_view_snapshot;
