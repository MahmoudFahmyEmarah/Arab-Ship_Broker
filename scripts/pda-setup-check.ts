// PDA · Setup workspace contract (O2ALL-008 increment D). Pure + static; no database.
//   node --import tsx scripts/pda-setup-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parsePdaTab, PDA_ESTIMATOR_TABS } from "../lib/pda/estimator-contract";
import { initialPdaTab, parsePdaPreferences, PDA_PREFERENCE_DEFAULTS } from "../lib/pda/preferences";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261018110000_pda_member_preferences.sql");
const down = read("supabase/rollback/20261018110000_pda_member_preferences_down.sql");
const setup = read("components/pda/PdaSetupWorkspace.tsx");
const estimator = read("components/pda/PdaRouteEstimator.tsx");
const actions = read("app/(dashboard)/dashboard/ports-da/actions.ts");
const bootstrap = read("app/(dashboard)/dashboard/ports-da/bootstrap.server.ts");
const model = read("lib/pda/preferences.ts");

// 1 · the model
ok(JSON.stringify(parsePdaPreferences(null)) === JSON.stringify(PDA_PREFERENCE_DEFAULTS), "a missing payload gives the defaults (compact, estimate, not saved)");
ok(parsePdaPreferences({ density: "comfortable", startTab: "ports", saved: true }).density === "comfortable", "saved values parse");
ok(parsePdaPreferences({ density: "huge", startTab: "agents", saved: "yes" }).startTab === "estimate"
  && parsePdaPreferences({ density: "huge" }).density === "compact" && parsePdaPreferences({ saved: "yes" }).saved === false,
  "unknown values fall back to the defaults; only a literal true counts as saved");
const portsFirst = { density: "compact" as const, startTab: "ports" as const, saved: true };
ok(initialPdaTab(portsFirst, false) === "ports" && initialPdaTab(portsFirst, true) === "estimate",
  "the start tab applies, but a handoff from another page always opens the Estimate");

// 2 · the database
ok(/check \(density in \('compact', 'comfortable'\)\)/.test(migration) && /check \(start_tab in \('estimate', 'ports'\)\)/.test(migration),
  "the table only accepts the two row heights and the two start tabs");
ok(/enable row level security/.test(migration) && /revoke all on table public\.pda_member_preferences from public, anon, authenticated, service_role;/.test(migration),
  "RLS on and no direct table grant to any API role");
ok(/where p\.user_id = v_user/.test(migration) && /values \(v_user, p_density, p_start_tab, now\(\)\)/.test(migration),
  "both RPCs act on the CALLER's own row only (fn_app_user_id)");
ok((migration.match(/if not public\.fn_pda_member_entitled\(\) then/g) ?? []).length === 2 && (migration.match(/PDA_VALIDATION/g) ?? []).length === 2,
  "both RPCs use the estimator's entitlement gate; the setter validates both values");
ok(/grant execute on function public\.get_my_pda_preferences\(\) to authenticated, service_role;/.test(migration)
  && /grant execute on function public\.set_my_pda_preferences\(text, text\) to authenticated, service_role;/.test(migration)
  && /revoke all on function public\.set_my_pda_preferences\(text, text\) from public, anon;/.test(migration),
  "RPC grants: anon none; authenticated and service_role");
ok(/PDA_DOWN_REFUSED/.test(down) && /asb\.pda_prefs_down/.test(down) && /drop table if exists public\.pda_member_preferences;/.test(down)
  && !/\\(gset|if|echo|endif)\b/.test(migration + down),
  "the DOWN refuses to discard saved preferences without an in-transaction confirmation; plain SQL");

// 3 · the page
ok(/getMyPdaPreferences\(supabase\)\.catch\(\(\) => PDA_PREFERENCE_DEFAULTS\)/.test(bootstrap), "preferences load with the page; an unreadable row falls back to the defaults");
ok(/export async function savePdaPreferences/.test(actions) && /const \{ supabase \} = await viewer\(\);\s*return \{ ok: true, data: await setMyPdaPreferences\(supabase, density, startTab\) \};/.test(actions),
  "saving goes through the member's own session after the estimator's viewer() gate");
ok(/initialPdaTab\(initialPreferences, hasHandoff, initialTab\)/.test(estimator) && /pda-route--\$\{density\}/.test(estimator),
  "the estimator opens on the saved tab (unless handed off or a validated ?tab= names one) and applies the saved row height");
ok(/activeTab === "setup" \? \(\s*<div className="pe-body"><PdaSetupWorkspace/.test(estimator), "the Setup tab renders the workspace inside the design's page body");
ok(!/localStorage|sessionStorage|indexedDB/.test(setup + model), "nothing is kept in browser storage (the prototype's store is not authorised)");
ok(/role="radiogroup"/.test(setup) && /aria-checked=/.test(setup) && /aria-labelledby=\{labelId\}/.test(setup) && /aria-live="polite"/.test(setup),
  "each preference is a labelled radiogroup; the save status is announced");
ok(/never changes a figure/.test(setup) && !/displayCurrency|allocation/.test(setup), "Setup offers presentation only: no currency or allocation (those change figures)");

// C2ALL-164 P1-1 · the canonical ?tab= contract
const hub = read("components/pda/PdaPortsHub.tsx");
const bootstrapServer = read("app/(dashboard)/dashboard/ports-da/bootstrap.server.ts");
ok(PDA_ESTIMATOR_TABS.length === 4 && parsePdaTab("setup") === "setup" && parsePdaTab(["ports"]) === "ports" && parsePdaTab("bogus") === null && parsePdaTab(undefined) === null && parsePdaTab(["bogus", "ports"]) === null,
  "parsePdaTab accepts exactly the four tab ids (first value of a repeated param) and answers null otherwise");
ok(initialPdaTab(PDA_PREFERENCE_DEFAULTS, false, "agents") === "agents" && initialPdaTab(PDA_PREFERENCE_DEFAULTS, true, "agents") === "estimate"
  && initialPdaTab({ ...PDA_PREFERENCE_DEFAULTS, startTab: "ports" }, false, null) === "ports" && initialPdaTab({ ...PDA_PREFERENCE_DEFAULTS, startTab: "ports" }, false) === "ports",
  "a validated ?tab= opens that tab; a handoff still opens Estimate; null (absent or invalid) falls back to the member's start tab");
ok(bootstrapServer.includes("initialTab: parsePdaTab(params.tab)") && estimator.includes("initialPdaTab(initialPreferences, hasHandoff, initialTab)")
  && estimator.includes('url.searchParams.set("tab", id)') && estimator.includes("window.history.replaceState(window.history.state") && (estimator.match(/selectTab\(/g) ?? []).length >= 6
  && (estimator.match(/setActiveTab\(/g) ?? []).length === 1,
  "the page passes the validated tab to the estimator, which honours it on first render and keeps the URL in step with every switch (clicks, arrows, Setup shortcuts, card actions)");
ok(hub.includes("const withOn = (href: string, on: string)") && hub.includes("href={withOn(t.href, on)}") && hub.includes("hub?arm=quick&on=${on}") && hub.includes("hub?arm=setup&on=${on}"),
  "every hub tool and arm link carries the selected date (C2ALL-164 P2-2)");

console.log(`PDA SETUP CHECK: ${n} passed`);
