-- Stream R: immutable, versioned Intelligence Rules.
--
-- This domain stores declarative, closed-schema rule data only.  Stored SQL,
-- JavaScript, templates and arbitrary object paths are not part of the model.
-- Member reads receive the active published document without actor, audit or
-- provenance data.  Every administration command is service-role-only and
-- independently validates the canonical public.users actor.

create table public.intelligence_rule_field_catalogue (
  entity                text not null check (entity in ('cargo', 'vessel')),
  field                 text not null check (field ~ '^[a-z][a-z0-9_]{1,63}$'),
  value_type            text not null check (value_type = 'number'),
  allowed_operators     text[] not null,
  unit                  text,
  label                 text not null check (length(btrim(label)) between 1 and 120),
  minimum_threshold     numeric not null,
  maximum_threshold     numeric not null,
  maximum_decimal_places smallint not null check (maximum_decimal_places between 0 and 6),
  primary key (entity, field),
  check (minimum_threshold <= maximum_threshold),
  check (cardinality(allowed_operators) > 0),
  check (allowed_operators <@ array['lt','gt','eq','ne','between','missing']::text[])
);

comment on table public.intelligence_rule_field_catalogue is
  'Closed fact whitelist for Intelligence Rules. Values are typed facts, never executable paths or expressions.';

insert into public.intelligence_rule_field_catalogue
  (entity, field, value_type, allowed_operators, unit, label, minimum_threshold, maximum_threshold, maximum_decimal_places)
values
  ('cargo',  'stowage_sf',             'number', array['lt','gt','eq','ne','between','missing'], 'm3/mt',  'Stowage factor',          0,    20, 6),
  ('cargo',  'load_rate_mt_day',        'number', array['lt','gt','eq','ne','between','missing'], 'mt/day', 'Load rate',               0, 100000, 6),
  ('cargo',  'laycan_days_remaining',   'number', array['lt','gt','eq','ne','between','missing'], 'days',   'Laycan days remaining', -365,   365, 6),
  ('cargo',  'freight_idea_usd_mt',     'number', array['lt','gt','eq','ne','between','missing'], 'USD/mt', 'Freight idea',            0,  10000, 6),
  ('cargo',  'commission_pct',          'number', array['lt','gt','eq','ne','between','missing'], '%',      'Commission',              0,    100, 6),
  ('vessel', 'age_years',               'number', array['lt','gt','eq','ne','between','missing'], 'years',  'Vessel age',              0,    100, 6),
  ('vessel', 'vlsfo_sea_mt_day',        'number', array['lt','gt','eq','ne','between','missing'], 'mt/day', 'VLSFO sea consumption',   0,    500, 6),
  ('vessel', 'lsmgo_sea_mt_day',        'number', array['lt','gt','eq','ne','between','missing'], 'mt/day', 'LSMGO sea consumption',   0,    500, 6),
  ('vessel', 'open_days_delta',         'number', array['lt','gt','eq','ne','between','missing'], 'days',   'Open-date days',        -365,    365, 6);

create table public.intelligence_rule_sets (
  id                 uuid primary key default gen_random_uuid(),
  version_no         bigint generated always as identity unique not null,
  schema_version     integer not null check (schema_version = 1),
  evaluator_version  text not null check (evaluator_version = 'intelligence-v1'),
  content_hash       text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  label              text not null check (length(btrim(label)) between 1 and 120),
  change_note        text not null check (length(btrim(change_note)) between 1 and 1000),
  based_on_id        uuid references public.intelligence_rule_sets(id) on delete restrict,
  created_by         uuid references public.users(id) on delete restrict,
  created_at         timestamptz not null default now()
);
create index intelligence_rule_sets_hash_idx on public.intelligence_rule_sets(content_hash);

create table public.intelligence_rule_groups (
  rule_set_id  uuid not null references public.intelligence_rule_sets(id) on delete cascade,
  code         text not null check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name         text not null check (length(btrim(name)) between 1 and 120),
  description  text check (description is null or length(btrim(description)) between 1 and 500),
  scope        text not null check (scope in ('cargo','vessel','both','framework')),
  active       boolean not null,
  priority     integer not null check (priority between 0 and 10000),
  primary key (rule_set_id, code),
  check (scope <> 'framework' or not active)
);

create table public.intelligence_rules (
  rule_set_id  uuid not null references public.intelligence_rule_sets(id) on delete cascade,
  rule_code    text not null check (rule_code ~ '^[A-Z][A-Z0-9_-]{2,31}$'),
  group_code   text not null,
  entity       text not null check (entity in ('cargo','vessel')),
  field        text not null,
  operator     text not null check (operator in ('lt','gt','eq','ne','between','missing')),
  threshold    jsonb,
  severity     text not null check (severity in ('good','info','warning','danger')),
  tag          text not null check (length(btrim(tag)) between 1 and 80),
  message      text not null check (length(btrim(message)) between 1 and 500),
  signal_key   text not null check (signal_key ~ '^[a-z][a-z0-9._-]{2,79}$'),
  active       boolean not null,
  priority     integer not null check (priority between 0 and 10000),
  primary key (rule_set_id, rule_code),
  foreign key (rule_set_id, group_code)
    references public.intelligence_rule_groups(rule_set_id, code) on delete cascade,
  foreign key (entity, field)
    references public.intelligence_rule_field_catalogue(entity, field) on delete restrict
);

comment on table public.intelligence_rules is
  'Immutable declarative rules interpreted by the pinned evaluator_version. No executable expression column exists.';

create table public.intelligence_rule_provenance (
  rule_set_id      uuid not null,
  rule_code        text not null,
  source_ref       text not null check (length(btrim(source_ref)) between 1 and 500),
  original_message text not null check (length(btrim(original_message)) between 1 and 1000),
  note             text check (note is null or length(btrim(note)) between 1 and 1000),
  primary key (rule_set_id, rule_code),
  foreign key (rule_set_id, rule_code)
    references public.intelligence_rules(rule_set_id, rule_code) on delete cascade
);

comment on table public.intelligence_rule_provenance is
  'Private source wording and review notes. This table is never projected by the authenticated active-rule RPC.';

create table public.intelligence_rule_state (
  singleton           boolean primary key default true check (singleton),
  active_rule_set_id  uuid references public.intelligence_rule_sets(id) on delete restrict,
  revision             bigint not null default 0 check (revision >= 0),
  activated_by         uuid references public.users(id) on delete restrict,
  activated_at         timestamptz,
  check ((active_rule_set_id is null and activated_at is null)
      or (active_rule_set_id is not null and activated_at is not null))
);
insert into public.intelligence_rule_state(singleton) values (true);

create table public.intelligence_rule_requests (
  actor_user_id  uuid not null references public.users(id) on delete restrict,
  command        text not null check (command in ('create_rule_set','activate_rule_set')),
  request_id     uuid not null,
  request_hash   text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result         jsonb,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  primary key (actor_user_id, command, request_id),
  check ((result is null and completed_at is null) or (result is not null and completed_at is not null))
);

create table public.intelligence_rule_events (
  id               bigint generated always as identity primary key,
  action           text not null check (action in (
    'version.created','version.activated','version.rolled_back','version.activation_noop','version.bootstrap_activated'
  )),
  rule_set_id      uuid references public.intelligence_rule_sets(id) on delete restrict,
  version_no       bigint,
  actor_user_id    uuid references public.users(id) on delete restrict,
  request_id       uuid,
  before_state     jsonb,
  after_state      jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index intelligence_rule_events_recent_idx on public.intelligence_rule_events(created_at desc, id desc);

-- Private by default. There are no table policies: all reads/writes pass
-- through the deliberately narrow SECURITY DEFINER RPCs below.
alter table public.intelligence_rule_field_catalogue enable row level security;
alter table public.intelligence_rule_sets enable row level security;
alter table public.intelligence_rule_groups enable row level security;
alter table public.intelligence_rules enable row level security;
alter table public.intelligence_rule_provenance enable row level security;
alter table public.intelligence_rule_state enable row level security;
alter table public.intelligence_rule_requests enable row level security;
alter table public.intelligence_rule_events enable row level security;

revoke all on table public.intelligence_rule_field_catalogue from public, anon, authenticated, service_role;
revoke all on table public.intelligence_rule_sets from public, anon, authenticated, service_role;
revoke all on table public.intelligence_rule_groups from public, anon, authenticated, service_role;
revoke all on table public.intelligence_rules from public, anon, authenticated, service_role;
revoke all on table public.intelligence_rule_provenance from public, anon, authenticated, service_role;
revoke all on table public.intelligence_rule_state from public, anon, authenticated, service_role;
revoke all on table public.intelligence_rule_requests from public, anon, authenticated, service_role;
revoke all on table public.intelligence_rule_events from public, anon, authenticated, service_role;
revoke all on sequence public.intelligence_rule_sets_version_no_seq from public, anon, authenticated, service_role;
revoke all on sequence public.intelligence_rule_events_id_seq from public, anon, authenticated, service_role;

create or replace function public.fn_intelligence_assert_admin_actor(
  p_actor uuid,
  p_edit boolean default false
)
returns void
language plpgsql stable security definer set search_path to ''
as $function$
begin
  if p_actor is null or not exists (
    select 1 from public.users u
    where u.id = p_actor
      and u.is_active
      and lower(coalesce(u.role, '')) = 'admin'
      and (
        lower(coalesce(nullif(u.admin_tier, ''), 'super')) = 'super'
        or (
          lower(coalesce(u.admin_tier, '')) = 'sub'
          and case when p_edit
            then lower(coalesce(u.admin_perms->>'intelligence', 'none')) = 'edit'
            else lower(coalesce(u.admin_perms->>'intelligence', 'none')) in ('view', 'edit')
          end
        )
      )
  ) then
    raise exception 'INTELLIGENCE_AUTH: active admin actor with intelligence % access required',
      case when p_edit then 'edit' else 'view' end using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.fn_intelligence_exact_keys(p_value jsonb, p_keys text[])
returns boolean
language plpgsql immutable set search_path to ''
as $function$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then return false; end if;
  return not exists (
      select 1 from jsonb_object_keys(p_value) k where not (k = any(p_keys))
    ) and not exists (
      select 1 from unnest(p_keys) k where not (p_value ? k)
    );
end;
$function$;

create or replace function public.fn_intelligence_jsonb_integer_between(
  p_value jsonb, p_minimum integer, p_maximum integer
)
returns boolean
language plpgsql immutable set search_path to ''
as $function$
declare v_value numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then return false; end if;
  v_value := (p_value #>> '{}')::numeric;
  return v_value = trunc(v_value) and v_value between p_minimum and p_maximum;
exception when others then
  return false;
end;
$function$;

-- Canonical JSON: ASCII key order, array order preserved, no insignificant
-- whitespace, numeric -0 normalised to 0. Input schema bounds prevent the
-- scientific-notation edge that differs between JS Number and PG numeric.
create or replace function public.fn_intelligence_canonical_json(p_value jsonb)
returns text
language plpgsql immutable set search_path to ''
as $function$
declare
  v_type text;
  v_out text;
  v_number numeric;
begin
  if p_value is null then return 'null'; end if;
  v_type := jsonb_typeof(p_value);
  if v_type in ('null','string','boolean') then return p_value::text; end if;
  if v_type = 'number' then
    v_number := (p_value #>> '{}')::numeric;
    if v_number = 0 then return '0'; end if;
    v_out := v_number::text;
    if position('.' in v_out) > 0 then
      v_out := regexp_replace(v_out, '0+$', '');
      v_out := regexp_replace(v_out, '\.$', '');
    end if;
    return v_out;
  end if;
  if v_type = 'array' then
    select '[' || coalesce(string_agg(public.fn_intelligence_canonical_json(x.value), ',' order by x.ordinality), '') || ']'
      into v_out
      from jsonb_array_elements(p_value) with ordinality x(value, ordinality);
    return v_out;
  end if;
  if v_type = 'object' then
    select '{' || coalesce(string_agg(to_jsonb(x.key)::text || ':' || public.fn_intelligence_canonical_json(x.value), ',' order by x.key collate "C"), '') || '}'
      into v_out
      from jsonb_each(p_value) x;
    return v_out;
  end if;
  raise exception 'INTELLIGENCE_INPUT: unsupported canonical JSON value' using errcode = '22023';
end;
$function$;

create or replace function public.fn_intelligence_sha256(p_value jsonb)
returns text
language sql immutable set search_path to ''
as $function$
  select encode(extensions.digest(convert_to(public.fn_intelligence_canonical_json(p_value), 'UTF8'), 'sha256'), 'hex')
$function$;

create or replace function public.fn_intelligence_threshold_valid(
  p_entity text,
  p_field text,
  p_operator text,
  p_threshold jsonb
)
returns boolean
language plpgsql stable set search_path to ''
as $function$
declare
  v_allowed text[];
  v_min numeric;
  v_max numeric;
  v_scale smallint;
  v_first numeric;
  v_second numeric;
begin
  if p_threshold is null then return false; end if;
  select c.allowed_operators, c.minimum_threshold, c.maximum_threshold, c.maximum_decimal_places
    into v_allowed, v_min, v_max, v_scale
    from public.intelligence_rule_field_catalogue c
   where c.entity = p_entity and c.field = p_field;
  if not found or not (p_operator = any(v_allowed)) then return false; end if;
  if p_operator = 'missing' then return p_threshold = 'null'::jsonb; end if;
  if p_operator = 'between' then
    if jsonb_typeof(p_threshold) <> 'array' or jsonb_array_length(p_threshold) <> 2
       or jsonb_typeof(p_threshold->0) <> 'number' or jsonb_typeof(p_threshold->1) <> 'number' then
      return false;
    end if;
    v_first := (p_threshold->>0)::numeric;
    v_second := (p_threshold->>1)::numeric;
    return v_first between v_min and v_max
       and v_second between v_min and v_max
       and v_first = round(v_first, v_scale)
       and v_second = round(v_second, v_scale)
       and v_first <= v_second;
  end if;
  if jsonb_typeof(p_threshold) <> 'number' then return false; end if;
  v_first := (p_threshold #>> '{}')::numeric;
  return v_first between v_min and v_max and v_first = round(v_first, v_scale);
exception when others then
  return false;
end;
$function$;

create or replace function public.fn_intelligence_validate_document(p_document jsonb)
returns void
language plpgsql stable set search_path to ''
as $function$
declare
  g jsonb;
  r jsonb;
  v_scope text;
begin
  if p_document is null
     or not public.fn_intelligence_exact_keys(p_document, array['schemaVersion','evaluatorVersion','groups','rules'])
     or not public.fn_intelligence_jsonb_integer_between(p_document->'schemaVersion', 1, 1)
     or jsonb_typeof(p_document->'evaluatorVersion') <> 'string'
     or p_document->>'evaluatorVersion' <> 'intelligence-v1'
     or jsonb_typeof(p_document->'groups') <> 'array'
     or jsonb_typeof(p_document->'rules') <> 'array' then
    raise exception 'INTELLIGENCE_INPUT: invalid or unsupported rule-set envelope' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_document->'groups') x
    where jsonb_typeof(x) <> 'object'
       or not public.fn_intelligence_exact_keys(x, array['code','name','description','scope','active','priority'])
       or jsonb_typeof(x->'code') <> 'string'
       or (x->>'code') !~ '^[a-z][a-z0-9_]{1,31}$'
       or jsonb_typeof(x->'name') <> 'string'
       or length(btrim(x->>'name', E' \t\n\r\f\013')) not between 1 and 120
       or x->>'name' <> btrim(x->>'name', E' \t\n\r\f\013')
       or (jsonb_typeof(x->'description') not in ('string','null'))
       or (jsonb_typeof(x->'description') = 'string' and length(btrim(x->>'description', E' \t\n\r\f\013')) not between 1 and 500)
       or (jsonb_typeof(x->'description') = 'string' and x->>'description' <> btrim(x->>'description', E' \t\n\r\f\013'))
       or jsonb_typeof(x->'scope') <> 'string'
       or (x->>'scope') not in ('cargo','vessel','both','framework')
       or jsonb_typeof(x->'active') <> 'boolean'
       or (x->>'scope') = 'framework' and x->'active' = 'true'::jsonb
       or not public.fn_intelligence_jsonb_integer_between(x->'priority', 0, 10000)
  ) then
    raise exception 'INTELLIGENCE_INPUT: invalid group schema or value' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_document->'groups')) <>
     (select count(distinct x->>'code') from jsonb_array_elements(p_document->'groups') x) then
    raise exception 'INTELLIGENCE_INPUT: duplicate group code' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_document->'rules') x
    where jsonb_typeof(x) <> 'object'
       or not public.fn_intelligence_exact_keys(x, array[
         'code','group','entity','field','operator','threshold','severity','tag','message','signalKey','active','priority'
       ])
       or jsonb_typeof(x->'code') <> 'string'
       or (x->>'code') !~ '^[A-Z][A-Z0-9_-]{2,31}$'
       or jsonb_typeof(x->'group') <> 'string'
       or (x->>'group') !~ '^[a-z][a-z0-9_]{1,31}$'
       or jsonb_typeof(x->'entity') <> 'string'
       or (x->>'entity') not in ('cargo','vessel')
       or jsonb_typeof(x->'field') <> 'string'
       or jsonb_typeof(x->'operator') <> 'string'
       or (x->>'operator') not in ('lt','gt','eq','ne','between','missing')
       or jsonb_typeof(x->'severity') <> 'string'
       or (x->>'severity') not in ('good','info','warning','danger')
       or jsonb_typeof(x->'tag') <> 'string'
       or length(btrim(x->>'tag', E' \t\n\r\f\013')) not between 1 and 80
       or x->>'tag' <> btrim(x->>'tag', E' \t\n\r\f\013')
       or jsonb_typeof(x->'message') <> 'string'
       or length(btrim(x->>'message', E' \t\n\r\f\013')) not between 1 and 500
       or x->>'message' <> btrim(x->>'message', E' \t\n\r\f\013')
       or jsonb_typeof(x->'signalKey') <> 'string'
       or (x->>'signalKey') !~ '^[a-z][a-z0-9._-]{2,79}$'
       or jsonb_typeof(x->'active') <> 'boolean'
       or not public.fn_intelligence_jsonb_integer_between(x->'priority', 0, 10000)
       or not public.fn_intelligence_threshold_valid(x->>'entity', x->>'field', x->>'operator', x->'threshold')
  ) then
    raise exception 'INTELLIGENCE_INPUT: invalid rule schema, field, operator or threshold' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_document->'rules')) <>
     (select count(distinct x->>'code') from jsonb_array_elements(p_document->'rules') x) then
    raise exception 'INTELLIGENCE_INPUT: duplicate rule code' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_document->'rules') loop
    select g0->>'scope' into v_scope
      from jsonb_array_elements(p_document->'groups') g0
     where g0->>'code' = r->>'group';
    if not found then
      raise exception 'INTELLIGENCE_INPUT: rule % references missing group %', r->>'code', r->>'group' using errcode = '22023';
    end if;
    if v_scope = 'framework' then
      raise exception 'INTELLIGENCE_INPUT: framework group % must remain empty', r->>'group' using errcode = '22023';
    end if;
    if v_scope <> 'both' and v_scope <> r->>'entity' then
      raise exception 'INTELLIGENCE_INPUT: rule % is outside group scope', r->>'code' using errcode = '22023';
    end if;
  end loop;
end;
$function$;

create or replace function public.fn_intelligence_validate_provenance(p_provenance jsonb, p_document jsonb)
returns void
language plpgsql stable set search_path to ''
as $function$
begin
  if p_provenance is null or jsonb_typeof(p_provenance) <> 'array' then
    raise exception 'INTELLIGENCE_INPUT: provenance must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_provenance) x
    where jsonb_typeof(x) <> 'object'
       or not public.fn_intelligence_exact_keys(x, array['ruleCode','sourceRef','originalMessage','note'])
       or jsonb_typeof(x->'ruleCode') <> 'string'
       or (x->>'ruleCode') !~ '^[A-Z][A-Z0-9_-]{2,31}$'
       or jsonb_typeof(x->'sourceRef') <> 'string'
       or length(btrim(x->>'sourceRef', E' \t\n\r\f\013')) not between 1 and 500
       or x->>'sourceRef' <> btrim(x->>'sourceRef', E' \t\n\r\f\013')
       or jsonb_typeof(x->'originalMessage') <> 'string'
       or length(btrim(x->>'originalMessage', E' \t\n\r\f\013')) not between 1 and 1000
       or x->>'originalMessage' <> btrim(x->>'originalMessage', E' \t\n\r\f\013')
       or jsonb_typeof(x->'note') not in ('string','null')
       or (jsonb_typeof(x->'note') = 'string' and length(btrim(x->>'note', E' \t\n\r\f\013')) not between 1 and 1000)
       or (jsonb_typeof(x->'note') = 'string' and x->>'note' <> btrim(x->>'note', E' \t\n\r\f\013'))
       or not exists (select 1 from jsonb_array_elements(p_document->'rules') r where r->>'code' = x->>'ruleCode')
  ) then
    raise exception 'INTELLIGENCE_INPUT: invalid provenance schema or rule reference' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_provenance)) <>
     (select count(distinct x->>'ruleCode') from jsonb_array_elements(p_provenance) x) then
    raise exception 'INTELLIGENCE_INPUT: duplicate rule provenance' using errcode = '22023';
  end if;
end;
$function$;

create or replace function public.fn_intelligence_group_guard()
returns trigger
language plpgsql set search_path to ''
as $function$
begin
  if new.scope = 'framework' and new.active then
    raise exception 'INTELLIGENCE_INPUT: framework groups must be inactive' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function public.fn_intelligence_rule_guard()
returns trigger
language plpgsql set search_path to ''
as $function$
declare v_scope text;
begin
  if not public.fn_intelligence_threshold_valid(new.entity, new.field, new.operator, new.threshold) then
    raise exception 'INTELLIGENCE_INPUT: invalid field, operator or threshold' using errcode = '22023';
  end if;
  select g.scope into v_scope from public.intelligence_rule_groups g
   where g.rule_set_id = new.rule_set_id and g.code = new.group_code;
  if not found or v_scope = 'framework' or (v_scope <> 'both' and v_scope <> new.entity) then
    raise exception 'INTELLIGENCE_INPUT: rule is outside its group scope' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger trg_intelligence_group_guard
before insert on public.intelligence_rule_groups
for each row execute function public.fn_intelligence_group_guard();
create trigger trg_intelligence_rule_guard
before insert on public.intelligence_rules
for each row execute function public.fn_intelligence_rule_guard();

create or replace function public.fn_intelligence_append_only()
returns trigger
language plpgsql set search_path to ''
as $function$
begin
  raise exception 'INTELLIGENCE_IMMUTABLE: % rows are append-only', tg_table_name using errcode = '55000';
end;
$function$;

create trigger trg_intelligence_catalogue_immutable before update or delete on public.intelligence_rule_field_catalogue
for each row execute function public.fn_intelligence_append_only();
create trigger trg_intelligence_sets_immutable before update or delete on public.intelligence_rule_sets
for each row execute function public.fn_intelligence_append_only();
create trigger trg_intelligence_groups_immutable before update or delete on public.intelligence_rule_groups
for each row execute function public.fn_intelligence_append_only();
create trigger trg_intelligence_rules_immutable before update or delete on public.intelligence_rules
for each row execute function public.fn_intelligence_append_only();
create trigger trg_intelligence_provenance_immutable before update or delete on public.intelligence_rule_provenance
for each row execute function public.fn_intelligence_append_only();
create trigger trg_intelligence_events_immutable before update or delete on public.intelligence_rule_events
for each row execute function public.fn_intelligence_append_only();

create or replace function public.fn_intelligence_rule_set_document(p_rule_set_id uuid)
returns jsonb
language sql stable set search_path to ''
as $function$
  select jsonb_build_object(
    'schemaVersion', s.schema_version,
    'evaluatorVersion', s.evaluator_version,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', g.code, 'name', g.name, 'description', g.description,
        'scope', g.scope, 'active', g.active, 'priority', g.priority
      ) order by g.priority, g.code collate "C")
      from public.intelligence_rule_groups g where g.rule_set_id = s.id
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', r.rule_code, 'group', r.group_code, 'entity', r.entity,
        'field', r.field, 'operator', r.operator, 'threshold', r.threshold,
        'severity', r.severity, 'tag', r.tag, 'message', r.message,
        'signalKey', r.signal_key, 'active', r.active, 'priority', r.priority
      ) order by g.priority, r.priority, r.rule_code collate "C")
      from public.intelligence_rules r
      join public.intelligence_rule_groups g on g.rule_set_id = r.rule_set_id and g.code = r.group_code
      where r.rule_set_id = s.id
    ), '[]'::jsonb)
  )
  from public.intelligence_rule_sets s where s.id = p_rule_set_id
$function$;

create or replace function public.fn_intelligence_effective_document(p_rule_set_id uuid)
returns jsonb
language sql stable set search_path to ''
as $function$
  select jsonb_build_object(
    'schemaVersion', s.schema_version,
    'evaluatorVersion', s.evaluator_version,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', g.code, 'name', g.name, 'description', g.description,
        'scope', g.scope, 'active', true, 'priority', g.priority
      ) order by g.priority, g.code collate "C")
      from public.intelligence_rule_groups g
      where g.rule_set_id = s.id and g.active and g.scope <> 'framework'
        and exists (select 1 from public.intelligence_rules r
          where r.rule_set_id=g.rule_set_id and r.group_code=g.code and r.active)
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', r.rule_code, 'group', r.group_code, 'entity', r.entity,
        'field', r.field, 'operator', r.operator, 'threshold', r.threshold,
        'severity', r.severity, 'tag', r.tag, 'message', r.message,
        'signalKey', r.signal_key, 'active', true, 'priority', r.priority
      ) order by g.priority, r.priority, r.rule_code collate "C")
      from public.intelligence_rules r
      join public.intelligence_rule_groups g on g.rule_set_id=r.rule_set_id and g.code=r.group_code
      where r.rule_set_id=s.id and r.active and g.active and g.scope <> 'framework'
    ), '[]'::jsonb)
  )
  from public.intelligence_rule_sets s where s.id = p_rule_set_id
$function$;

create or replace function public.fn_intelligence_request_begin(
  p_actor uuid, p_command text, p_request_id uuid, p_request_hash text
)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $function$
declare v_request public.intelligence_rule_requests%rowtype;
begin
  if p_request_id is null then
    raise exception 'INTELLIGENCE_INPUT: request id is required' using errcode = '22023';
  end if;
  insert into public.intelligence_rule_requests(actor_user_id, command, request_id, request_hash)
  values (p_actor, p_command, p_request_id, p_request_hash)
  on conflict (actor_user_id, command, request_id) do nothing;

  select * into v_request from public.intelligence_rule_requests
   where actor_user_id = p_actor and command = p_command and request_id = p_request_id
   for update;
  if v_request.request_hash <> p_request_hash then
    raise exception 'INTELLIGENCE_IDEMPOTENCY: request id was reused with different arguments' using errcode = 'P0001';
  end if;
  return v_request.result;
end;
$function$;

create or replace function public.fn_intelligence_request_finish(
  p_actor uuid, p_command text, p_request_id uuid, p_result jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $function$
begin
  update public.intelligence_rule_requests
     set result = p_result, completed_at = now()
   where actor_user_id = p_actor and command = p_command and request_id = p_request_id
     and result is null;
  if not found then
    raise exception 'INTELLIGENCE_STATE: idempotency request was not open' using errcode = '55000';
  end if;
  return p_result;
end;
$function$;

create or replace function public.admin_intelligence_create_rule_set(
  p_actor uuid,
  p_document jsonb,
  p_provenance jsonb,
  p_label text,
  p_change_note text,
  p_based_on_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $function$
declare
  v_document jsonb;
  v_hash text;
  v_request_hash text;
  v_replay jsonb;
  v_set public.intelligence_rule_sets%rowtype;
  v_result jsonb;
begin
  perform public.fn_intelligence_assert_admin_actor(p_actor, true);
  if p_label is null or length(btrim(p_label)) not between 1 and 120
     or p_change_note is null or length(btrim(p_change_note)) not between 1 and 1000 then
    raise exception 'INTELLIGENCE_INPUT: label and change note are required' using errcode = '22023';
  end if;
  perform public.fn_intelligence_validate_document(p_document);
  perform public.fn_intelligence_validate_provenance(p_provenance, p_document);

  -- Normalise array order before identity is computed. The hash is therefore
  -- the exact shape reconstructed from persisted rows, not caller formatting.
  v_document := jsonb_build_object(
    'schemaVersion', 1,
    'evaluatorVersion', 'intelligence-v1',
    'groups', coalesce((
      select jsonb_agg(x order by (x->>'priority')::integer, (x->>'code') collate "C")
      from jsonb_array_elements(p_document->'groups') x
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(q.rule order by q.group_priority, q.rule_priority, q.rule_code collate "C")
      from (
        select r as rule,
               (r->>'priority')::integer as rule_priority,
               r->>'code' as rule_code,
               (select (g->>'priority')::integer from jsonb_array_elements(p_document->'groups') g
                 where g->>'code' = r->>'group') as group_priority
        from jsonb_array_elements(p_document->'rules') r
      ) q
    ), '[]'::jsonb)
  );
  v_hash := public.fn_intelligence_sha256(v_document);
  v_request_hash := public.fn_intelligence_sha256(jsonb_build_object(
    'document', v_document, 'provenance', p_provenance, 'label', p_label,
    'changeNote', p_change_note, 'basedOnId', p_based_on_id
  ));

  perform pg_advisory_xact_lock(hashtextextended('asb:intelligence-rules', 0));
  v_replay := public.fn_intelligence_request_begin(p_actor, 'create_rule_set', p_request_id, v_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_based_on_id is not null and not exists (
    select 1 from public.intelligence_rule_sets s where s.id = p_based_on_id
  ) then
    raise exception 'INTELLIGENCE_NOT_FOUND: based-on rule set does not exist' using errcode = 'P0002';
  end if;

  insert into public.intelligence_rule_sets(
    schema_version, evaluator_version, content_hash, label, change_note, based_on_id, created_by
  ) values (1, 'intelligence-v1', v_hash, btrim(p_label), btrim(p_change_note), p_based_on_id, p_actor)
  returning * into v_set;

  insert into public.intelligence_rule_groups(rule_set_id, code, name, description, scope, active, priority)
  select v_set.id, x->>'code', x->>'name', nullif(x->>'description',''), x->>'scope',
         (x->>'active')::boolean, (x->>'priority')::integer
  from jsonb_array_elements(v_document->'groups') x;

  insert into public.intelligence_rules(
    rule_set_id, rule_code, group_code, entity, field, operator, threshold,
    severity, tag, message, signal_key, active, priority
  )
  select v_set.id, x->>'code', x->>'group', x->>'entity', x->>'field', x->>'operator', x->'threshold',
         x->>'severity', x->>'tag', x->>'message', x->>'signalKey',
         (x->>'active')::boolean, (x->>'priority')::integer
  from jsonb_array_elements(v_document->'rules') x;

  insert into public.intelligence_rule_provenance(rule_set_id, rule_code, source_ref, original_message, note)
  select v_set.id, x->>'ruleCode', x->>'sourceRef', x->>'originalMessage', nullif(x->>'note','')
  from jsonb_array_elements(p_provenance) x;

  if public.fn_intelligence_rule_set_document(v_set.id) is distinct from v_document
     or public.fn_intelligence_sha256(public.fn_intelligence_rule_set_document(v_set.id)) <> v_hash then
    raise exception 'INTELLIGENCE_STATE: persisted document does not match canonical input' using errcode = '55000';
  end if;

  insert into public.intelligence_rule_events(
    action, rule_set_id, version_no, actor_user_id, request_id, after_state, metadata
  ) values (
    'version.created', v_set.id, v_set.version_no, p_actor, p_request_id,
    jsonb_build_object('ruleSetId',v_set.id,'version',v_set.version_no,'contentHash',v_hash),
    jsonb_build_object('basedOnId',p_based_on_id,'label',v_set.label)
  );
  v_result := jsonb_build_object(
    'ruleSetId', v_set.id, 'version', v_set.version_no, 'contentHash', v_hash,
    'schemaVersion', v_set.schema_version, 'evaluatorVersion', v_set.evaluator_version
  );
  return public.fn_intelligence_request_finish(p_actor, 'create_rule_set', p_request_id, v_result);
end;
$function$;

create or replace function public.admin_intelligence_activate_rule_set(
  p_actor uuid,
  p_rule_set_id uuid,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $function$
declare
  v_set public.intelligence_rule_sets%rowtype;
  v_state public.intelligence_rule_state%rowtype;
  v_old_version bigint;
  v_group_count integer;
  v_rule_count integer;
  v_request_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_action text;
begin
  perform public.fn_intelligence_assert_admin_actor(p_actor, true);
  if p_rule_set_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'INTELLIGENCE_INPUT: rule set and expected revision are required' using errcode = '22023';
  end if;
  v_request_hash := public.fn_intelligence_sha256(jsonb_build_object(
    'ruleSetId', p_rule_set_id, 'expectedRevision', p_expected_revision
  ));
  perform pg_advisory_xact_lock(hashtextextended('asb:intelligence-rules', 0));
  v_replay := public.fn_intelligence_request_begin(p_actor, 'activate_rule_set', p_request_id, v_request_hash);
  if v_replay is not null then return v_replay; end if;

  select * into v_set from public.intelligence_rule_sets s where s.id = p_rule_set_id;
  if not found then raise exception 'INTELLIGENCE_NOT_FOUND: rule set does not exist' using errcode = 'P0002'; end if;
  if public.fn_intelligence_sha256(public.fn_intelligence_rule_set_document(v_set.id)) <> v_set.content_hash then
    raise exception 'INTELLIGENCE_STATE: content hash mismatch' using errcode = '55000';
  end if;
  select * into v_state from public.intelligence_rule_state where singleton for update;
  if v_state.revision <> p_expected_revision then
    raise exception 'INTELLIGENCE_CONFLICT: expected revision %, current revision %', p_expected_revision, v_state.revision using errcode = '40001';
  end if;

  select count(distinct g.code), count(r.rule_code)
    into v_group_count, v_rule_count
    from public.intelligence_rule_groups g
    left join public.intelligence_rules r
      on r.rule_set_id = g.rule_set_id and r.group_code = g.code and r.active
   where g.rule_set_id = v_set.id and g.active and g.scope <> 'framework'
     and exists (
       select 1 from public.intelligence_rules e
       where e.rule_set_id = g.rule_set_id and e.group_code = g.code and e.active
     );
  if coalesce(v_group_count,0) = 0 or coalesce(v_rule_count,0) = 0 then
    raise exception 'INTELLIGENCE_STATE: activation requires at least one effective active group and rule' using errcode = '55000';
  end if;

  if v_state.active_rule_set_id = v_set.id then
    v_action := 'version.activation_noop';
    v_result := jsonb_build_object('ruleSetId',v_set.id,'version',v_set.version_no,
      'contentHash',v_set.content_hash,'revision',v_state.revision,'status','already_active');
  else
    select s.version_no into v_old_version from public.intelligence_rule_sets s where s.id = v_state.active_rule_set_id;
    v_action := case when v_old_version is not null and v_set.version_no < v_old_version
      then 'version.rolled_back' else 'version.activated' end;
    update public.intelligence_rule_state
       set active_rule_set_id = v_set.id,
           revision = revision + 1,
           activated_by = p_actor,
           activated_at = now()
     where singleton;
    v_result := jsonb_build_object('ruleSetId',v_set.id,'version',v_set.version_no,
      'contentHash',v_set.content_hash,'revision',v_state.revision + 1,'status','active');
  end if;

  insert into public.intelligence_rule_events(
    action, rule_set_id, version_no, actor_user_id, request_id, before_state, after_state
  ) values (
    v_action, v_set.id, v_set.version_no, p_actor, p_request_id,
    jsonb_build_object('ruleSetId',v_state.active_rule_set_id,'revision',v_state.revision),
    v_result
  );
  return public.fn_intelligence_request_finish(p_actor, 'activate_rule_set', p_request_id, v_result);
end;
$function$;

create or replace function public.get_intelligence_rules()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v_out jsonb; v_actor uuid;
begin
  v_actor := public.fn_app_user_id();
  if v_actor is null or not exists (
    select 1 from public.users u where u.id = v_actor and u.is_active
  ) then
    raise exception 'INTELLIGENCE_AUTH: active authenticated application user required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'version', s.version_no,
    'ruleSetContentHash', s.content_hash,
    'effectiveContentHash', public.fn_intelligence_sha256(public.fn_intelligence_effective_document(s.id)),
    'document', public.fn_intelligence_effective_document(s.id)
  ) into v_out
  from public.intelligence_rule_state st
  join public.intelligence_rule_sets s on s.id = st.active_rule_set_id
  where st.singleton;
  return v_out;
end;
$function$;

create or replace function public.admin_intelligence_list_rule_sets(p_actor uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v_out jsonb;
begin
  perform public.fn_intelligence_assert_admin_actor(p_actor, false);
  select jsonb_build_object(
    'activeRuleSetId', st.active_rule_set_id,
    'revision', st.revision,
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'ruleSetId', s.id, 'version', s.version_no, 'label', s.label,
        'contentHash', s.content_hash, 'schemaVersion', s.schema_version,
        'evaluatorVersion', s.evaluator_version, 'basedOnId', s.based_on_id,
        'changeNote', s.change_note, 'createdBy', s.created_by, 'createdAt', s.created_at,
        'groupCount', (select count(*) from public.intelligence_rule_groups g where g.rule_set_id = s.id),
        'ruleCount', (select count(*) from public.intelligence_rules r where r.rule_set_id = s.id),
        'isActive', s.id = st.active_rule_set_id
      ) order by s.version_no desc)
      from public.intelligence_rule_sets s), '[]'::jsonb)
  ) into v_out
  from public.intelligence_rule_state st
  where st.singleton;
  return v_out;
end;
$function$;

create or replace function public.admin_intelligence_get_rule_set(p_actor uuid, p_rule_set_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v_out jsonb;
begin
  perform public.fn_intelligence_assert_admin_actor(p_actor, false);
  select jsonb_build_object(
    'ruleSetId', s.id, 'version', s.version_no, 'label', s.label,
    'contentHash', s.content_hash, 'changeNote', s.change_note,
    'basedOnId', s.based_on_id, 'createdBy', s.created_by, 'createdAt', s.created_at,
    'document', public.fn_intelligence_rule_set_document(s.id),
    'provenance', coalesce((select jsonb_agg(jsonb_build_object(
      'ruleCode', p.rule_code, 'sourceRef', p.source_ref,
      'originalMessage', p.original_message, 'note', p.note
    ) order by p.rule_code collate "C") from public.intelligence_rule_provenance p where p.rule_set_id = s.id), '[]'::jsonb)
  ) into v_out
  from public.intelligence_rule_sets s where s.id = p_rule_set_id;
  if v_out is null then raise exception 'INTELLIGENCE_NOT_FOUND: rule set does not exist' using errcode = 'P0002'; end if;
  return v_out;
end;
$function$;

create or replace function public.admin_intelligence_get_clone_input(p_actor uuid, p_rule_set_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v_detail jsonb;
begin
  v_detail := public.admin_intelligence_get_rule_set(p_actor, p_rule_set_id);
  return jsonb_build_object(
    'basedOnId', p_rule_set_id,
    'suggestedLabel', (v_detail->>'label') || ' copy',
    'document', v_detail->'document',
    'provenance', v_detail->'provenance'
  );
end;
$function$;

create or replace function public.admin_intelligence_diff_rule_sets(
  p_actor uuid, p_left_rule_set_id uuid, p_right_rule_set_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v_left jsonb; v_right jsonb;
begin
  perform public.fn_intelligence_assert_admin_actor(p_actor, false);
  v_left := public.fn_intelligence_rule_set_document(p_left_rule_set_id);
  v_right := public.fn_intelligence_rule_set_document(p_right_rule_set_id);
  if v_left is null or v_right is null then
    raise exception 'INTELLIGENCE_NOT_FOUND: both rule sets are required' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'leftRuleSetId', p_left_rule_set_id,
    'rightRuleSetId', p_right_rule_set_id,
    'groups', jsonb_build_object(
      'added', coalesce((select jsonb_agg(code order by code collate "C") from (
        select x->>'code' code from jsonb_array_elements(v_right->'groups') x
        except select x->>'code' from jsonb_array_elements(v_left->'groups') x
      ) a), '[]'::jsonb),
      'removed', coalesce((select jsonb_agg(code order by code collate "C") from (
        select x->>'code' code from jsonb_array_elements(v_left->'groups') x
        except select x->>'code' from jsonb_array_elements(v_right->'groups') x
      ) a), '[]'::jsonb),
      'changed', coalesce((select jsonb_agg(l->>'code' order by (l->>'code') collate "C")
        from jsonb_array_elements(v_left->'groups') l
        join jsonb_array_elements(v_right->'groups') r on r->>'code' = l->>'code'
        where l is distinct from r), '[]'::jsonb)
    ),
    'rules', jsonb_build_object(
      'added', coalesce((select jsonb_agg(code order by code collate "C") from (
        select x->>'code' code from jsonb_array_elements(v_right->'rules') x
        except select x->>'code' from jsonb_array_elements(v_left->'rules') x
      ) a), '[]'::jsonb),
      'removed', coalesce((select jsonb_agg(code order by code collate "C") from (
        select x->>'code' code from jsonb_array_elements(v_left->'rules') x
        except select x->>'code' from jsonb_array_elements(v_right->'rules') x
      ) a), '[]'::jsonb),
      'changed', coalesce((select jsonb_agg(l->>'code' order by (l->>'code') collate "C")
        from jsonb_array_elements(v_left->'rules') l
        join jsonb_array_elements(v_right->'rules') r on r->>'code' = l->>'code'
        where l is distinct from r), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'added', coalesce((select jsonb_agg(rule_code order by rule_code collate "C") from (
        select p.rule_code from public.intelligence_rule_provenance p where p.rule_set_id=p_right_rule_set_id
        except
        select p.rule_code from public.intelligence_rule_provenance p where p.rule_set_id=p_left_rule_set_id
      ) a), '[]'::jsonb),
      'removed', coalesce((select jsonb_agg(rule_code order by rule_code collate "C") from (
        select p.rule_code from public.intelligence_rule_provenance p where p.rule_set_id=p_left_rule_set_id
        except
        select p.rule_code from public.intelligence_rule_provenance p where p.rule_set_id=p_right_rule_set_id
      ) a), '[]'::jsonb),
      'changed', coalesce((select jsonb_agg(l.rule_code order by l.rule_code collate "C")
        from public.intelligence_rule_provenance l
        join public.intelligence_rule_provenance r
          on r.rule_set_id=p_right_rule_set_id and r.rule_code=l.rule_code
        where l.rule_set_id=p_left_rule_set_id
          and (l.source_ref,l.original_message,l.note)
              is distinct from (r.source_ref,r.original_message,r.note)), '[]'::jsonb)
    )
  );
end;
$function$;

create or replace function public.admin_intelligence_list_events(p_actor uuid, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v_out jsonb;
begin
  perform public.fn_intelligence_assert_admin_actor(p_actor, false);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb)
    into v_out
    from (
      select e.id, e.action, e.rule_set_id, e.version_no, e.actor_user_id,
             e.request_id, e.before_state, e.after_state, e.metadata, e.created_at
      from public.intelligence_rule_events e
      order by e.created_at desc, e.id desc
      limit greatest(1, least(coalesce(p_limit,100),500))
    ) x;
  return v_out;
end;
$function$;

-- Internal helpers stay unreachable even to service_role; only the public
-- command/read contracts below receive explicit grants.
revoke all on function public.fn_intelligence_assert_admin_actor(uuid,boolean) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_exact_keys(jsonb,text[]) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_jsonb_integer_between(jsonb,integer,integer) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_canonical_json(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_threshold_valid(text,text,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_validate_document(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_validate_provenance(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_group_guard() from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_rule_guard() from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_append_only() from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_rule_set_document(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_effective_document(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_request_begin(uuid,text,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.fn_intelligence_request_finish(uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

revoke all on function public.admin_intelligence_create_rule_set(uuid,jsonb,jsonb,text,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_intelligence_activate_rule_set(uuid,uuid,bigint,uuid) from public, anon, authenticated;
revoke all on function public.admin_intelligence_list_rule_sets(uuid) from public, anon, authenticated;
revoke all on function public.admin_intelligence_get_rule_set(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_intelligence_get_clone_input(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_intelligence_diff_rule_sets(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_intelligence_list_events(uuid,integer) from public, anon, authenticated;
grant execute on function public.admin_intelligence_create_rule_set(uuid,jsonb,jsonb,text,text,uuid,uuid) to service_role;
grant execute on function public.admin_intelligence_activate_rule_set(uuid,uuid,bigint,uuid) to service_role;
grant execute on function public.admin_intelligence_list_rule_sets(uuid) to service_role;
grant execute on function public.admin_intelligence_get_rule_set(uuid,uuid) to service_role;
grant execute on function public.admin_intelligence_get_clone_input(uuid,uuid) to service_role;
grant execute on function public.admin_intelligence_diff_rule_sets(uuid,uuid,uuid) to service_role;
grant execute on function public.admin_intelligence_list_events(uuid,integer) to service_role;

revoke all on function public.get_intelligence_rules() from public, anon;
grant execute on function public.get_intelligence_rules() to authenticated;
