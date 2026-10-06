-- Cross-runtime Intelligence identity proof.
--
-- The three digests below are also pinned in lib/intelligence/golden.ts and
-- asserted by scripts/intelligence-rules-check.ts. This file deliberately
-- rebuilds the identities from persisted SQL data so neither runtime can
-- silently redefine the other.
begin;

do $parity$
declare
  v_rule_set_id constant uuid := '31010000-0000-4000-8000-000000000001';
  v_seed_hash constant text := '9822f365aac993cc1102106b73c90e76373178c14c448365bd685d54ffd28e9d';
  v_effective_hash constant text := 'e22b26d9bdf086e1975431ee4110f206b15ac4f1c496deec47be46dc6bc8011d';
  v_catalogue_hash constant text := '728835d8551c1ada72190191e0e0791ea0dd47dfc957c779d68eb0103b746b9c';
  v_document jsonb;
  v_effective jsonb;
  v_catalogue jsonb;
begin
  select public.fn_intelligence_rule_set_document(v_rule_set_id)
    into v_document;
  if v_document is null then
    raise exception 'INTELLIGENCE PARITY: v1 seed rule set is missing';
  end if;
  if public.fn_intelligence_sha256(v_document) <> v_seed_hash then
    raise exception 'INTELLIGENCE PARITY: SQL full seed digest differs from TypeScript golden';
  end if;
  if (select content_hash from public.intelligence_rule_sets where id = v_rule_set_id) <> v_seed_hash then
    raise exception 'INTELLIGENCE PARITY: persisted content_hash is not the cross-runtime seed digest';
  end if;

  v_effective := public.fn_intelligence_effective_document(v_rule_set_id);
  if public.fn_intelligence_sha256(v_effective) <> v_effective_hash then
    raise exception 'INTELLIGENCE PARITY: SQL member document differs from TypeScript effective golden';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_effective->'rules') r
    where not (r->>'active')::boolean or r->>'code' = 'R-010'
  ) or exists (
    select 1 from jsonb_array_elements(v_effective->'groups') g
    where not (g->>'active')::boolean or g->>'scope' = 'framework'
  ) then
    raise exception 'INTELLIGENCE PARITY: effective identity includes inactive/framework content';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'entity', c.entity,
    'field', c.field,
    'valueKind', c.value_type,
    'allowedOperators', to_jsonb(c.allowed_operators),
    'unit', c.unit,
    'label', c.label,
    'minimumThreshold', c.minimum_threshold,
    'maximumThreshold', c.maximum_threshold,
    'maximumDecimalPlaces', c.maximum_decimal_places
  ) order by c.entity collate "C", c.field collate "C"), '[]'::jsonb)
    into v_catalogue
    from public.intelligence_rule_field_catalogue c;
  if jsonb_array_length(v_catalogue) <> 9 then
    raise exception 'INTELLIGENCE PARITY: expected nine closed-vocabulary fields';
  end if;
  if public.fn_intelligence_sha256(v_catalogue) <> v_catalogue_hash then
    raise exception 'INTELLIGENCE PARITY: SQL field catalogue differs from TypeScript golden';
  end if;

  if (select count(*) from public.intelligence_rules
      where rule_set_id = v_rule_set_id and rule_code like 'R-%') <> 10
     or exists (select 1 from public.intelligence_rules
      where rule_set_id = v_rule_set_id and rule_code like 'UI-%') then
    raise exception 'INTELLIGENCE PARITY: governed R cardinality changed or unapproved UI rules were seeded';
  end if;
end;
$parity$;

do $marker$ begin
  raise notice 'INTELLIGENCE CROSS-RUNTIME PARITY: ALL ASSERTIONS PASSED';
end $marker$;
rollback;
