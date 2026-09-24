-- PDA Estimator Phase 1 rollback. Run only before the integration-owned
-- Fixture/PDA foreign-key migration exists.

drop function if exists public.pda_decide_staged_rule(uuid, uuid, text, text);
drop function if exists public.pda_stage_tariff_import(uuid, uuid, text, jsonb, jsonb);
drop function if exists public.pda_upsert_tariff_publisher(uuid, jsonb);

drop function if exists public.get_pda_estimate(uuid);
drop function if exists public.fn_pda_estimate_header(uuid);
drop function if exists public.fn_can_read_pda_estimate(uuid);
drop function if exists public.pda_save_estimate(uuid, uuid, jsonb, jsonb, uuid);
drop function if exists public.list_pda_terminals(text);
drop function if exists public.list_pda_coverage(date);
drop function if exists public.get_pda_calculation_context(text, uuid, date);
drop function if exists public.fn_pda_member_entitled();

drop table if exists public.pda_estimate_lines;
drop table if exists public.pda_estimates;
drop function if exists public.fn_pda_snapshot_immutable();

drop function if exists public.pda_publish_tariff_version(uuid, uuid);
drop function if exists public.pda_return_tariff_version(uuid, uuid, text);
drop function if exists public.pda_submit_tariff_version(uuid, uuid);
drop function if exists public.pda_replace_tariff_rules(uuid, uuid, jsonb);
drop function if exists public.pda_create_tariff_draft(uuid, jsonb);
drop function if exists public.pda_register_tariff_source(uuid, jsonb);
drop function if exists public.pda_verify_port_terminal(uuid, uuid);
drop function if exists public.pda_upsert_port_terminal(uuid, jsonb);
drop function if exists public.fn_pda_assert_admin_actor(uuid);

drop table if exists public.port_tariff_bands;
drop table if exists public.port_tariff_rules;
drop table if exists public.port_tariff_versions;
drop table if exists public.port_tariff_sets;
drop table if exists public.tariff_staged_rules;
drop table if exists public.tariff_import_batches;
drop table if exists public.tariff_sources;
drop table if exists public.tariff_publishers;
drop table if exists public.port_terminals;

drop function if exists public.fn_pda_version_immutable();
drop function if exists public.fn_pda_version_child_mutable();
