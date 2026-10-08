-- DOWN for 20261007320000_pda_fx_ecb_feed. Rates already recorded by the feed stay (they are governed history in
-- pda_fx_rates, removed only by the 20261007310000 DOWN, which refuses while rates exist).
drop function if exists public.pda_record_fx_rate_system(jsonb);
