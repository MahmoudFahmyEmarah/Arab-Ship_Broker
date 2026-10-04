-- Exact rollback proof for an unchanged matching source universe.
-- Local/isolated only: rules-harness.sh enforces current_database()=asb_rules.
begin;

create temporary table matching_rollback_unchanged_expect as
select
  matches_rows,
  matches_rows_sha256,
  source_rows_sha256
from public.matching_rule_rollback_catalog
where singleton;

do $before_down$
declare
  v_expected matching_rollback_unchanged_expect%rowtype;
begin
  select * into strict v_expected from matching_rollback_unchanged_expect;
  if public.fn_matching_rollback_source_sha256() <> v_expected.source_rows_sha256 then
    raise exception 'MATCHING ROLLBACK TEST: supposedly unchanged source fingerprint already differs';
  end if;
end;
$before_down$;

-- @RULES_DOWN@

do $after_down$
declare
  v_expected matching_rollback_unchanged_expect%rowtype;
  v_actual jsonb;
begin
  select * into strict v_expected from matching_rollback_unchanged_expect;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
    into v_actual
  from public.matches m;

  if v_actual is distinct from v_expected.matches_rows
     or encode(extensions.digest(v_actual::text, 'sha256'), 'hex')
          <> v_expected.matches_rows_sha256 then
    raise exception 'MATCHING ROLLBACK TEST: unchanged sources did not restore the exact cache snapshot';
  end if;
  if to_regclass('public.matching_rule_rollback_catalog') is not null
     or to_regprocedure('public.fn_matching_rollback_source_sha256()') is not null then
    raise exception 'MATCHING ROLLBACK TEST: rollback-only catalogue/helper survived the DOWN';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'matches'
      and column_name = any(array[
        'matching_rule_version_id', 'match_score', 'is_rate_aligned',
        'dwt_delta', 'matching_as_of_year'
      ])
  ) then
    raise exception 'MATCHING ROLLBACK TEST: governed cache columns survived the DOWN';
  end if;
end;
$after_down$;

select 'MATCHING UNCHANGED ROLLBACK: ALL ASSERTIONS PASSED' as result;
rollback;
