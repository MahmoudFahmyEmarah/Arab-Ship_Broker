"""Usage: python scripts/pda-pr10a-generate.py <repo root>

Generate 20261006300000_pda_compound_bases.sql and its DOWN from the original
function definitions, so the redefinitions are verbatim copies plus the PR-10a
changes (no hand re-typing of 250 lines of SQL)."""
import re, sys, pathlib

repo = pathlib.Path(sys.argv[1])
mig = repo / "supabase" / "migrations"
pub = (mig / "20260923101000_pda_tariff_publication.sql").read_text(encoding="utf8").replace("\r\n", "\n")
reads = (mig / "20260923102000_pda_estimates_and_reads.sql").read_text(encoding="utf8").replace("\r\n", "\n")

def extract(src: str, name: str, sig: str) -> str:
    start = src.index(f"create or replace function public.{name}(")
    end_body = src.index("\n$$;\n", start) + len("\n$$;\n")
    tail = src[end_body:]
    grants = []
    for line in tail.split("\n"):
        if line.startswith(("revoke ", "grant ")) and f"public.{name}({sig})" in line:
            grants.append(line)
        elif line.strip() == "":
            if grants:
                break
            continue
        else:
            break
    return src[start:end_body] + "\n".join(grants) + "\n"

def patch(text: str, pairs):
    for a, b in pairs:
        assert text.count(a) == 1, (a[:80], text.count(a))
        text = text.replace(a, b)
    return text

old_replace = extract(pub, "pda_replace_tariff_rules", "uuid, uuid, jsonb")
old_context = extract(reads, "get_pda_calculation_context", "text, uuid, date")

new_replace = patch(old_replace, [
    ("'minDraftM','maxDraftM','minCargoQuantityMt','maxCargoQuantityMt','percentageBaseCodes')) then",
     "'minDraftM','maxDraftM','minCargoQuantityMt','maxCargoQuantityMt','percentageBaseCodes','settlementModes')) then"),
    ("      where e.key in ('requestedServices','vesselTypes','cargoTypes','cargoStatuses','voyageScopes','locations','percentageBaseCodes')\n        and (jsonb_typeof(e.value) <> 'array'",
     "      where e.key in ('requestedServices','vesselTypes','cargoTypes','cargoStatuses','voyageScopes','locations','percentageBaseCodes','settlementModes')\n        and (jsonb_typeof(e.value) <> 'array'"),
    ("      where e.key in ('requestedServices','vesselTypes','cargoTypes','cargoStatuses','voyageScopes','locations','percentageBaseCodes')\n        and (jsonb_array_length(e.value) > 100",
     "      where e.key in ('requestedServices','vesselTypes','cargoTypes','cargoStatuses','voyageScopes','locations','percentageBaseCodes','settlementModes')\n        and (jsonb_array_length(e.value) > 100"),
    ("       or exists (select 1 from jsonb_array_elements_text(coalesce(v_rule#>'{applicability,locations}','[]'::jsonb)) item(value) where item.value not in ('alongside','anchorage'))",
     "       or exists (select 1 from jsonb_array_elements_text(coalesce(v_rule#>'{applicability,locations}','[]'::jsonb)) item(value) where item.value not in ('alongside','anchorage'))\n       or exists (select 1 from jsonb_array_elements_text(coalesce(v_rule#>'{applicability,settlementModes}','[]'::jsonb)) item(value) where item.value not in ('cash','agent_account'))"),
    # C2B-009: the two-value enumerated lists match the TypeScript schema (at most
    # two entries, each once), so a published rule always parses in the app.
    ("    if (v_rule->>'basis') = 'percentage'\n       and jsonb_array_length",
     "    if exists (select 1 from jsonb_each(coalesce(v_rule->'applicability','{}'::jsonb)) e\n"
     "      where e.key in ('cargoStatuses','voyageScopes','locations','settlementModes')\n"
     "        and (jsonb_array_length(e.value) > 2\n"
     "             or (select count(distinct x.value) from jsonb_array_elements_text(e.value) x(value)) <> jsonb_array_length(e.value))) then\n"
     "      raise exception 'PDA_APPLICABILITY: % two-value lists take each value at most once', v_rule->>'code' using errcode = '22023';\n"
     "    end if;\n"
     "    -- PR-10a: duration rounding is declared per rule; existing rules default to exact, unit 1.\n"
     "    if nullif(v_rule->>'rounding','') is not null and (v_rule->>'rounding') not in ('exact','started') then\n"
     "      raise exception 'PDA_ROUNDING: % rounding must be exact or started', v_rule->>'code' using errcode = '22023';\n"
     "    end if;\n"
     "    if nullif(v_rule->>'unitSize','') is not null and (jsonb_typeof(v_rule->'unitSize') <> 'number' or (v_rule->>'unitSize')::numeric <= 0) then\n"
     "      raise exception 'PDA_ROUNDING: % unit size must be a positive number', v_rule->>'code' using errcode = '22023';\n"
     "    end if;\n"
     "    if (v_rule->>'basis') = 'percentage'\n       and jsonb_array_length"),
    ("      included_units, minimum_amount, maximum_amount, tax_percent, applicability,\n      manual_instructions, source_id, source_page, source_sheet, source_excerpt\n    ) values (",
     "      included_units, minimum_amount, maximum_amount, tax_percent, applicability,\n      manual_instructions, source_id, source_page, source_sheet, source_excerpt,\n      duration_rounding, unit_size\n    ) values ("),
    ("      nullif(v_rule->>'sourcePage',''), nullif(v_rule->>'sourceSheet',''), nullif(v_rule->>'sourceExcerpt','')\n    ) returning id into v_rule_id;",
     "      nullif(v_rule->>'sourcePage',''), nullif(v_rule->>'sourceSheet',''), nullif(v_rule->>'sourceExcerpt',''),\n"
     "      coalesce(nullif(v_rule->>'rounding',''), 'exact'), coalesce(nullif(v_rule->>'unitSize','')::numeric, 1)\n    ) returning id into v_rule_id;"),
])

new_context = patch(old_context, [
    ("      'includedUnits', r.included_units,\n",
     "      'includedUnits', r.included_units,\n      'rounding', r.duration_rounding,\n      'unitSize', r.unit_size,\n"),
])

BASES_OLD = ("'flat','per_call','per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa',\n"
             "    'per_cargo_mt','per_unit','percentage','tiered_flat','tiered_rate','progressive','manual_quote'")
BASES_NEW = ("'flat','per_call','per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa',\n"
             "    'per_cargo_mt','per_unit','per_gt_day','per_loa_day','per_loa_hour',\n"
             "    'percentage','tiered_flat','tiered_rate','progressive','manual_quote'")
RATE_OLD = "'per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa','per_cargo_mt','per_unit','percentage'"
RATE_NEW = "'per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa','per_cargo_mt','per_unit','per_gt_day','per_loa_day','per_loa_hour','percentage'"

up = f"""-- PDA PR-10a (Codex contract C2O-046; implemented by Opus B, audited by Codex).
--  * Compound bases: per_gt_day (rate x GT x days), per_loa_day (rate x LOA m x days),
--    per_loa_hour (rate x LOA m x hours). They need a rate, like the other per_* bases.
--  * Every rule declares its duration rounding: exact, or started (ceil(duration /
--    unit_size)), with unit_size in days or hours. Existing rules default to exact
--    and unit 1, so their results are unchanged.
--  * settlementModes ('cash' | 'agent_account') becomes an applicability condition;
--    the call carries a typed settlement mode, and a missing one is MISSING_INPUT.
-- pda_replace_tariff_rules and get_pda_calculation_context are the 20260923 bodies,
-- copied verbatim with only these changes (generated by scripts/pda-pr10a-generate.py; rerun it to reproduce).

alter table public.port_tariff_rules
  add column if not exists duration_rounding text not null default 'exact',
  add column if not exists unit_size numeric(18,6) not null default 1;

alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_rounding_ck;
alter table public.port_tariff_rules add constraint port_tariff_rules_rounding_ck
  check (duration_rounding in ('exact','started') and unit_size > 0);

alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_basis_check;
alter table public.port_tariff_rules add constraint port_tariff_rules_basis_check check (basis in (
    {BASES_NEW}
  ));

alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_basis_value_ck;
alter table public.port_tariff_rules add constraint port_tariff_rules_basis_value_ck check (
    (basis in ('flat','per_call') and coalesce(amount, rate) is not null)
    or (basis in ({RATE_NEW}) and rate is not null)
    or basis in ('tiered_flat','tiered_rate','progressive','manual_quote')
  );

alter table public.pda_estimate_lines drop constraint if exists pda_estimate_lines_basis_ck;
alter table public.pda_estimate_lines add constraint pda_estimate_lines_basis_ck check (basis in (
    {BASES_NEW},'manual'
  ));

{new_replace}
{new_context}"""

down = f"""-- DOWN for 20261006300000_pda_compound_bases (PDA PR-10a). Refuses while any
-- rule or estimate line uses what the migration added. Run inside one transaction.

do $$
begin
  if exists (select 1 from public.port_tariff_rules
              where basis in ('per_gt_day','per_loa_day','per_loa_hour')
                 or duration_rounding <> 'exact' or unit_size <> 1
                 or applicability ? 'settlementModes')
     or exists (select 1 from public.pda_estimate_lines where basis in ('per_gt_day','per_loa_day','per_loa_hour')) then
    raise exception 'PDA_DOWN: PR-10a features are in use; export and remove those rules/estimates first';
  end if;
end $$;

{old_replace}
{old_context}
alter table public.pda_estimate_lines drop constraint if exists pda_estimate_lines_basis_ck;
alter table public.pda_estimate_lines add constraint pda_estimate_lines_basis_ck check (basis in (
    {BASES_OLD},'manual'
  ));
alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_basis_value_ck;
alter table public.port_tariff_rules add constraint port_tariff_rules_basis_value_ck check (
    (basis in ('flat','per_call') and coalesce(amount, rate) is not null)
    or (basis in ({RATE_OLD}) and rate is not null)
    or basis in ('tiered_flat','tiered_rate','progressive','manual_quote')
  );
alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_basis_check;
alter table public.port_tariff_rules add constraint port_tariff_rules_basis_check check (basis in (
    {BASES_OLD}
  ));
alter table public.port_tariff_rules drop constraint if exists port_tariff_rules_rounding_ck;
alter table public.port_tariff_rules drop column if exists unit_size;
alter table public.port_tariff_rules drop column if exists duration_rounding;

delete from supabase_migrations.schema_migrations where version = '20261006300000';
"""

(mig / "20261006300000_pda_compound_bases.sql").write_text(up, encoding="utf8", newline="\n")
(repo / "supabase" / "rollback" / "20261006300000_pda_compound_bases_down.sql").write_text(down, encoding="utf8", newline="\n")
print("written", len(up), len(down))
