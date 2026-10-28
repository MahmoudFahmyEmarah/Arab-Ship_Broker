-- DOWN for 20261019130000_pda_tariff_packs: drops the three read functions. They hold no data, so nothing to export.
set local lock_timeout = '5s';
drop function if exists public.get_pda_tariff_pack(text, date);
drop function if exists public.list_pda_tariff_packs(date);
drop function if exists public.fn_pda_tariff_pack_ref(uuid);
