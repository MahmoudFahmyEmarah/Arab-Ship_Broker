-- Dashboard review follow-ups (9 Sep 2026)
--
-- 1. Two trigger functions on cargo_listings / vessel_availability referenced
--    tables without a schema and had no search_path, so any update through the
--    audited RPCs (edit_live_record, bulk_update_live_records, dq_apply_fix —
--    all run with search_path = '') failed with "relation ports does not
--    exist". Pin their search_path.
alter function public.fn_cl_port_autofill() set search_path = public;
alter function public.fn_submission_route() set search_path = public;

-- 2. DQ-C09 — a commodity is one specific commodity. "Grain (Corn/Maize)",
--    "Big Bag (unspecified)", "Bundled Cargo (harmless)" are not names the
--    dictionary should carry; the owner asked the module to catch them.
--    (The dictionary row itself was renamed to "Corn (Maize)" through the
--    audited edit path, with the old name kept as a market-name alias.)
select public.fn_dq_seed_rule(
  'DQ-C09', 'Commodity name is one specific commodity', 'validity', 'warn', 'declarative', 'suggest only', 'admin',
  'A commodity name must name one commodity. Names that bundle alternatives ("Corn/Maize", "Corn + Wheat"), carry a category word in front ("Grain (…)", "Minerals (…)") or say "unspecified" / "harmless" / "various" belong in Manual Review: split the parcel or bind the name to an official code.',
  $$regex: name !~ '(/|\+| or |unspecified|harmless|various|misc)' and name !~* '^(grain|minerals?|fertili[sz]ers?|agri|cargo)\s*\('$$,
  jsonb_build_array(
    jsonb_build_object('table', 'cargo_listings', 'field', 'commodity_name',
      'violation_sql', $$r.commodity_name is not null and (r.commodity_name ~* '((?<!\d)/(?!\d)|\+|\bor\b|unspecified|harmless|various|misc\.?|assorted)' or r.commodity_name ~* '^(grain|minerals?|fertili[sz]ers?|agri|cargo|goods)\s*\(')$$,
      'expected_text', 'one specific commodity (split multi-parcel; bind vague names in Manual Review)',
      'expected_sql', $$coalesce((select m.market_name || ' → ' || m.code from public.market_names m where m.regime <> 'UNMAPPED' and lower(m.market_name) = lower(btrim(r.commodity_name)) limit 1), 'one specific commodity (split multi-parcel; bind vague names in Manual Review)')$$,
      'message', 'Name one commodity per parcel; vague or bundled names go to Manual Review.'),
    jsonb_build_object('table', 'commodities', 'field', 'canonical_name',
      'violation_sql', $$r.is_active and (r.canonical_name ~* '((?<!\d)/(?!\d)|\+|\bor\b|unspecified|harmless|various|misc\.?|assorted)' or r.canonical_name ~* '^(grain|minerals?|fertili[sz]ers?|agri|cargo|goods)\s*\(')$$,
      'expected_text', 'a specific canonical name; keep the market wording as a display alias'),
    jsonb_build_object('table', 'market_names', 'field', 'market_name',
      'violation_sql', $$r.regime <> 'UNMAPPED' and (r.market_name ~* '((?<!\d)/(?!\d)|\+|unspecified|harmless|various|misc\.?|assorted)' or r.market_name ~* '^(grain|minerals?|fertili[sz]ers?|agri|cargo|goods)\s*\(')$$,
      'expected_text', 'an alias bound to one official code (multi-parcel names stay UNMAPPED and split)')));
