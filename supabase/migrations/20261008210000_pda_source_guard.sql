-- PDA source guard (Codex C2O-089 B2C-042 P1; forward fix because staging carries 20261007330000).
--  1. Registration (pda_register_tariff_source) and attestation (pda_attest_tariff_source) are the only write paths
--     for tariff_sources: service_role keeps SELECT only (REVOKE ALL, then GRANT SELECT; C2O-094 P2), so no service
--     path can raise, lower or relabel a source's authority, or change its evidence, without the immutable
--     attestation row. Both commands are SECURITY DEFINER and keep working.
--  2. Publication rechecks the authority of EVERY source cited by the version's rules, as submission already does
--     (it rechecked only the primary source).
revoke all on table public.tariff_sources from service_role;
grant select on table public.tariff_sources to service_role;

create or replace function public.pda_publish_tariff_version(p_actor uuid, p_version_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v public.port_tariff_versions%rowtype;
  v_source_authority text;
  v_overlap uuid;
  v_overlap_count integer;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  select * into v from public.port_tariff_versions where id = p_version_id for update;
  if not found then raise exception 'PDA_NOT_FOUND: tariff version not found' using errcode = 'P0002'; end if;
  if v.status <> 'in_review' then raise exception 'PDA_STATE: tariff must be in review' using errcode = '55000'; end if;
  if v.created_by = p_actor then raise exception 'PDA_CHECKER: maker cannot approve own tariff' using errcode = '42501'; end if;
  select authority into v_source_authority from public.tariff_sources where id = v.primary_source_id;
  if v_source_authority not in ('official','agent','statutory') then
    raise exception 'PDA_SOURCE: unverified/reference source cannot be published' using errcode = '55000';
  end if;
  if not exists (select 1 from public.port_tariff_rules where tariff_version_id = p_version_id) then
    raise exception 'PDA_RULES: tariff has no rules' using errcode = '55000';
  end if;
  -- C2O-089: recheck every cited source at publication, not only the primary one (closes the submit/publish gap).
  if exists (
    select 1 from public.port_tariff_rules r join public.tariff_sources s on s.id = r.source_id
    where r.tariff_version_id = p_version_id and s.authority not in ('official','agent','statutory')
  ) then
    raise exception 'PDA_SOURCE: every published rule requires trusted evidence' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v.tariff_set_id::text, 0));
  select (array_agg(x.id))[1], count(*) into v_overlap, v_overlap_count
  from public.port_tariff_versions x
  where x.tariff_set_id = v.tariff_set_id and x.id <> v.id and x.status = 'published'
    and daterange(x.effective_from, coalesce(x.effective_to + 1, 'infinity'::date), '[)') &&
        daterange(v.effective_from, coalesce(v.effective_to + 1, 'infinity'::date), '[)')
  ;
  if v_overlap_count > 1 then
    raise exception 'PDA_OVERLAP: a version cannot replace multiple overlapping publications; withdraw or split the ranges first' using errcode = '23505';
  end if;
  if v_overlap is not null and v.supersedes_id is distinct from v_overlap then
    raise exception 'PDA_OVERLAP: overlapping publication must explicitly supersede %', v_overlap using errcode = '23505';
  end if;
  if v_overlap is not null then
    update public.port_tariff_versions set status = 'superseded' where id = v_overlap;
  end if;
  update public.port_tariff_versions
  set status = 'published', approved_by = p_actor, approved_at = now(), published_at = now()
  where id = p_version_id;
end;
$$;
revoke all on function public.pda_publish_tariff_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pda_publish_tariff_version(uuid, uuid) to service_role;
