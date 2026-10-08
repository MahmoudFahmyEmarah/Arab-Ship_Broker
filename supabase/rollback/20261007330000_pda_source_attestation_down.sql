-- DOWN for 20261007330000_pda_source_attestation. Refuses while any attestation is recorded: an attested
-- source may already back a published tariff, so its history is not dropped silently. Export it first.
do $down$
begin
  if to_regclass('public.tariff_source_attestations') is not null and exists (select 1 from public.tariff_source_attestations) then
    raise exception 'PDA_ATTEST_DOWN: % attestation(s) exist; export them first',
      (select count(*) from public.tariff_source_attestations) using errcode = '55000';
  end if;
end
$down$;

drop function if exists public.pda_attest_tariff_source(uuid, jsonb);
drop table if exists public.tariff_source_attestations;
drop function if exists public.fn_pda_attestations_append_only();
