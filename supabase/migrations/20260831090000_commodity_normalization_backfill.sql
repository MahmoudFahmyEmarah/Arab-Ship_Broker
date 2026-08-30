-- Commodity normalization backfill.
--
-- The ingestion pipeline used to store raw commodity phrases verbatim
-- ("Brucite Ore in big bags", "wheat in bulk") with commodity_id NULL and
-- packaging_type unused. The pipeline now splits packaging out and links the
-- catalog (lib/sync/commodity.ts); this migration applies the SAME rules to
-- the rows already in cargo_listings:
--   1. extract the packaging phrase into packaging_type
--   2. clean the commodity_name (packaging words removed, canonical spelling
--      when the catalog matches)
--   3. set commodity_id on a catalog match (canonical_name or alias,
--      singular/plural tolerated)
--   4. queue every name that still cannot be resolved into
--      commodity_review_queue for Manual Review.
-- Conservative by design: a cleaned name that degenerates to a generic word
-- ("Bagged Cargo" → "Cargo") keeps its original wording.

begin;

create temp table _cn_resolved on commit drop as
with base as (
  select
    cl.id,
    cl.ref,
    cl.commodity_name as raw_name,
    (regexp_match(
      cl.commodity_name,
      'in\s+(?:big|jumbo)\s*-?\s*bags?|(?:big|jumbo)\s*-?\s*bags?|in\s+bb\.?s?\y|in\s+bags?|bagged|in\s+bulk|\(\s*bulk\s*\)|in\s+bundles?|bundled|in\s+drums?|palleti[sz]ed|in\s+pallets?|in\s+sacks?|in\s+rolls?|in\s+barrels?|in\s+cartons?|in\s+crates?',
      'i'
    ))[1] as pack_raw,
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              cl.commodity_name,
              'in\s+(?:big|jumbo)\s*-?\s*bags?|(?:big|jumbo)\s*-?\s*bags?|in\s+bb\.?s?\y|in\s+bags?|bagged|in\s+bulk|\(\s*bulk\s*\)|in\s+bundles?|bundled|in\s+drums?|palleti[sz]ed|in\s+pallets?|in\s+sacks?|in\s+rolls?|in\s+barrels?|in\s+cartons?|in\s+crates?',
              ' ', 'gi'
            ),
            '\(\s*\)', ' ', 'g'
          ),
          '\s+', ' ', 'g'
        ),
        ' -–—,/&'
      ),
      ''
    ) as stripped
  from public.cargo_listings cl
  where cl.commodity_id is null
    and cl.commodity_name is not null
),
cleaned as (
  select
    id, ref, raw_name, pack_raw,
    case
      when pack_raw is null then null
      when pack_raw ~* '(big|jumbo|bb)' then 'big bags'
      when pack_raw ~* 'bag'    then 'bags'
      when pack_raw ~* 'bulk'   then 'bulk'
      when pack_raw ~* 'bundle' then 'bundles'
      when pack_raw ~* 'drum'   then 'drums'
      when pack_raw ~* 'pallet' then 'pallets'
      when pack_raw ~* 'sack'   then 'sacks'
      when pack_raw ~* 'roll'   then 'rolls'
      when pack_raw ~* 'barrel' then 'barrels'
      when pack_raw ~* 'carton' then 'cartons'
      when pack_raw ~* 'crate'  then 'crates'
    end as pack_label,
    -- degenerate residues keep the original wording (judged on the normalized
    -- key so "(unspecified)" and "unspecified" are the same)
    case
      when stripped is null
        or length(btrim(regexp_replace(lower(stripped), '[^a-z0-9]+', ' ', 'g'))) < 3
        or btrim(regexp_replace(lower(stripped), '[^a-z0-9]+', ' ', 'g')) in ('cargo', 'general cargo', 'unspecified', 'harmless')
        or btrim(regexp_replace(lower(stripped), '[^a-z0-9]+', ' ', 'g')) like 'cargo%'
      then raw_name
      else stripped
    end as clean_name
  from base
),
catalog as (
  select distinct on (k.key)
    c.id as commodity_id,
    c.canonical_name,
    k.key
  from public.commodities c
  cross join lateral (
    select btrim(regexp_replace(lower(n), '[^a-z0-9]+', ' ', 'g')) as key
    from unnest(array[c.canonical_name] || coalesce(c.display_aliases, '{}')) as n
  ) k
  where c.is_active and k.key <> ''
  order by k.key, c.sort_order nulls last, c.canonical_name
)
select
  cl.id, cl.ref, cl.raw_name, cl.pack_label, cl.clean_name,
  m.commodity_id, m.canonical_name
from cleaned cl
cross join lateral (
  select btrim(regexp_replace(lower(cl.clean_name), '[^a-z0-9]+', ' ', 'g')) as key
) ck
left join catalog m
  on m.key = ck.key
  or m.key = ck.key || 's'
  or m.key || 's' = ck.key;

-- 1+2+3 · apply name/packaging/link where anything actually changes
update public.cargo_listings cl
set
  commodity_id   = coalesce(r.commodity_id, cl.commodity_id),
  commodity_name = coalesce(r.canonical_name, r.clean_name),
  packaging_type = coalesce(cl.packaging_type, r.pack_label),
  updated_at     = now()
from _cn_resolved r
where cl.id = r.id
  and (
    r.commodity_id is not null
    or coalesce(r.canonical_name, r.clean_name) is distinct from cl.commodity_name
    or (cl.packaging_type is null and r.pack_label is not null)
  );

-- 4 · unresolved names → Manual Review queue (idempotent per raw_name)
insert into public.commodity_review_queue (raw_name, sample_ref, source)
select distinct on (r.clean_name) r.clean_name, r.ref, 'backfill'
from _cn_resolved r
where r.commodity_id is null
order by r.clean_name, r.ref
on conflict (raw_name) do nothing;

commit;
