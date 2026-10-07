-- PDA source provenance attestation (owner, 7 Oct 2026: "you can allow admins to add such data").
-- A tariff source is registered once per SHA-256; until now its authority could never change, so a document
-- registered as 'reference' or 'unverified' (provenance unknown, e.g. the Turkish pack) could never back a
-- published tariff, even after an admin learned where it came from.
--  * pda_attest_tariff_source lets an owner-only admin (the same actor rule as every PDA admin command) raise a
--    source's authority from unverified/reference to agent/official/statutory, stating the provenance: who
--    supplied or issued it, when, and how it was obtained (at least 20 characters).
--  * Upgrade only. A source is never downgraded here: a version it backs is withdrawn through the existing path.
--  * Every attestation is an append-only row (from, to, provenance, actor, time). It is the audit trail the
--    checker reads before publishing; maker ≠ checker at publication is unchanged.
create table if not exists public.tariff_source_attestations (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.tariff_sources(id) on delete restrict,
  from_authority text not null,
  to_authority   text not null,
  provenance     text not null,
  attested_by    uuid not null references public.users(id) on delete restrict,
  attested_at    timestamptz not null default now(),
  constraint tariff_source_attestations_from_ck check (from_authority in ('unverified','reference')),
  constraint tariff_source_attestations_to_ck check (to_authority in ('agent','official','statutory')),
  constraint tariff_source_attestations_provenance_ck check (length(trim(provenance)) between 20 and 2000)
);
comment on table public.tariff_source_attestations is
  'Append-only provenance attestations: an admin raised a tariff source''s authority and stated where the document came from.';
create index if not exists tariff_source_attestations_source_idx on public.tariff_source_attestations (source_id, attested_at desc);

alter table public.tariff_source_attestations enable row level security;
revoke all on table public.tariff_source_attestations from public, anon, authenticated, service_role;
grant select on table public.tariff_source_attestations to service_role;

create or replace function public.fn_pda_attestations_append_only()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  raise exception 'PDA_ATTEST: attestations are append-only' using errcode = '55000';
end;
$$;
revoke all on function public.fn_pda_attestations_append_only() from public, anon, authenticated;

drop trigger if exists trg_pda_attestations_append_only on public.tariff_source_attestations;
create trigger trg_pda_attestations_append_only
before update or delete on public.tariff_source_attestations
for each row execute function public.fn_pda_attestations_append_only();

create or replace function public.pda_attest_tariff_source(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_source_id uuid;
  v_to text := lower(trim(coalesce(p_payload->>'authority', '')));
  v_provenance text := trim(coalesce(p_payload->>'provenance', ''));
  v_from text;
  v_id uuid;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  begin
    v_source_id := (p_payload->>'sourceId')::uuid;
  exception when invalid_text_representation then
    raise exception 'PDA_INPUT: sourceId must be a source id' using errcode = '22023';
  end;
  if v_to not in ('agent','official','statutory') then
    raise exception 'PDA_ATTEST: the attested authority must be agent, official or statutory' using errcode = '22023';
  end if;
  if length(v_provenance) < 20 or length(v_provenance) > 2000 then
    raise exception 'PDA_ATTEST: state the provenance (who supplied or issued the document, when, how) in 20 to 2000 characters'
      using errcode = '22023';
  end if;
  select authority into v_from from public.tariff_sources where id = v_source_id for update;
  if not found then
    raise exception 'PDA_INPUT: tariff source not found' using errcode = 'P0002';
  end if;
  if v_from not in ('unverified','reference') then
    raise exception 'PDA_ATTEST: the source is already %; attestation only raises unverified or reference sources', v_from
      using errcode = '55000';
  end if;

  insert into public.tariff_source_attestations (source_id, from_authority, to_authority, provenance, attested_by)
  values (v_source_id, v_from, v_to, v_provenance, p_actor)
  returning id into v_id;
  update public.tariff_sources set authority = v_to where id = v_source_id;
  return v_id;
end;
$$;
revoke all on function public.pda_attest_tariff_source(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pda_attest_tariff_source(uuid, jsonb) to service_role;
comment on function public.pda_attest_tariff_source(uuid, jsonb) is
  'PDA: an owner-only admin raises a tariff source from unverified/reference to agent/official/statutory with a stated provenance (append-only audit row).';
