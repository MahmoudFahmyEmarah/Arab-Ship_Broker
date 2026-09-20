// The enforcement policy, in one place (Data Quality workstream E, 19 Sep 2026;
// discovery scan added 20 Sep).
//
//   draft        the row is being drafted or staged: evaluate, collect, warn.
//                Nothing is refused; the issues ride with the draft.
//   publication  the row is about to be live, approved, committed or edited
//                in place: strict — a block-mode rule refuses the write, and
//                so does a rule that cannot evaluate (fail closed).
//   override     an administrator may go past a publication refusal with a
//                named actor, a reason and an event record.
//   restricted   not a publication, and limited in what it can write at all:
//                the row it creates is invisible to members, or the path
//                physically cannot set the fields that would matter. Every
//                one names an owner, a reason, a risk level and the test that
//                proves the limit still holds.
//   ungated      a write path to a registered table that nothing evaluates
//                and nothing limits. NONE MAY EXIST: the register carried
//                eight on 20 Sep 2026 and carries none after 21 Sep, and
//                scripts/dq-write-paths-check.ts fails if one returns.
//
// Every write path to a registered table is listed below with the policy it
// runs under and the code marker that proves it. scripts/dq-write-paths-check.ts
// reads each file and fails when a marker is missing — and it SCANS the
// application and the migrations for writes nobody declared: a direct
// insert/update/upsert/delete on a registered table, a call to a publication
// RPC, or a SECURITY DEFINER function that writes a registered table without
// naming its channel (set_config('dq.channel', …)) and without an entry in
// DQ_SQL_WRITERS explaining who gates it.

export type DqPolicy = "draft" | "publication" | "override" | "restricted" | "ungated";

/**
 * Why a restricted path is allowed to stay restricted. Not decoration: the
 * checker refuses a restricted path that does not carry one of these, and
 * refuses a `test` that names a file which does not exist.
 */
export interface DqRestriction {
  /** who answers for this path staying restricted */
  owner: string;
  /** what limits it — the mechanism, not the intention */
  rationale: string;
  risk: "low" | "medium" | "high";
  /** the automated test that proves the limit, as a repo-relative path */
  test: string;
}

export interface DqWritePath {
  id: string;
  /** what the path is, in the words the console uses */
  label: string;
  tables: string[];
  channel: "forms" | "admin" | "sync" | "review" | "pipeline" | "api";
  policy: DqPolicy;
  /** repo-relative file that implements the path */
  file: string;
  /** a string that must appear in that file — the call that applies the policy */
  marker: string;
  /** not built yet: listed so the policy is decided before the path exists */
  planned?: boolean;
  /** for "ungated": why it is tolerated for now */
  note?: string;
  /** required for "restricted" */
  exception?: DqRestriction;
}

/** The tables the Data Quality module registers (dq_tables). */
export const DQ_REGISTERED_TABLES = ["cargo_listings", "vessel_availability", "vessels", "organizations", "ports", "commodities", "market_names", "sync_staged_row"] as const;

/**
 * Tables carrying a gate trigger (trg_*_zz_dq_gate → fn_dq_forms_gate). Rules
 * already run against these, so a service-role write that names no channel is
 * a REAL bypass rather than a documented gap: the trigger returns early for
 * it. scripts/dq-write-paths-check.ts proves each name has its trigger in the
 * migrations, and refuses to let an ungated path touch one.
 */
export const DQ_GATE_TRIGGER_TABLES = ["cargo_listings", "vessel_availability", "vessels"] as const;

/**
 * The write paths allowed to be RESTRICTED, by id. A ratchet, not a
 * description: the checker fails when the two sets differ, so a new exception
 * cannot appear without a deliberate edit here — which is the whole point of
 * the register.
 *
 * DQ_UNGATED_ALLOWED is deliberately empty and must stay so. An ungated path
 * is one nothing evaluates and nothing limits; there is no longer a single
 * one, and the checker fails if one appears.
 */
export const DQ_RESTRICTED_ALLOWED = [
  "forms.signup.org",
  "forms.port.autocomplete",
  "forms.port.availability",
] as const;

export const DQ_UNGATED_ALLOWED = [] as const;

/** RPCs that publish or change rows of registered tables; a file calling one must be declared below. */
export const DQ_PUBLICATION_RPCS = [
  "edit_live_record", "insert_live_record", "bulk_update_live_records", "delete_live_record", "bulk_delete_live_records",
  "commit_sync_batch", "regate_sync_batch", "undo_sync_batch",
  "resolve_vessel_review", "resolve_commodity_review", "resolve_port_review",
  "create_cargo_listing", "create_cargo_listing_v2", "create_vessel_availability", "create_vessel_position", "register_vessel",
  "dq_apply_fix", "dq_apply_fixes", "dq_undo_fix",
] as const;

export const DQ_WRITE_PATHS: DqWritePath[] = [
  // ── member forms ───────────────────────────────────────────────────────────
  { id: "forms.cargo.v1", label: "Post Cargo (classic form)", tables: ["cargo_listings"], channel: "forms", policy: "draft",
    file: "components/cargo/CargoForm.tsx", marker: "validateMemberDraft(" },
  { id: "forms.cargo.v2", label: "Post Cargo (broker ledger)", tables: ["cargo_listings"], channel: "forms", policy: "draft",
    file: "components/ledger/cargo/CargoLedger.tsx", marker: "validateMemberDraft(" },
  { id: "forms.position", label: "Post Position (broker ledger)", tables: ["vessel_availability", "vessels"], channel: "forms", policy: "draft",
    file: "components/ledger/vessel/VesselLedger.tsx", marker: "validateMemberDraft(" },
  { id: "forms.sdk.cargo", label: "Member SDK — cargo listings (create, update, withdraw)", tables: ["cargo_listings"], channel: "forms", policy: "draft",
    file: "sdk/app/cargos.ts", marker: "create_cargo_listing", note: "authenticated client: trg_cl_zz_dq_gate judges every insert and update on the forms channel" },
  { id: "forms.sdk.ledger", label: "Member SDK — broker ledger (cargo v2, positions)", tables: ["cargo_listings", "vessel_availability", "vessels"], channel: "forms", policy: "draft",
    file: "sdk/app/ledger.ts", marker: "create_cargo_listing_v2", note: "authenticated client: the gate triggers judge the rows" },
  { id: "forms.sdk.vessels", label: "Member SDK — vessels and positions (register, availability, update)", tables: ["vessel_availability", "vessels"], channel: "forms", policy: "draft",
    file: "sdk/app/vessels.ts", marker: "create_vessel_availability", note: "authenticated client: trg_va_zz_dq_gate / trg_v_zz_dq_gate judge the rows" },
  { id: "forms.signup.org", label: "Member signup creates the organisation profile", tables: ["organizations"], channel: "forms", policy: "restricted",
    file: "app/(auth)/auth/signup/actions.ts", marker: "fn_dq_signup_create_org",
    exception: {
      owner: "Owner / IT (ASB admin console → Organisations)",
      rationale: "The path is fn_dq_signup_create_org(name, org_type, email_domain): the function takes three parameters and inserts three columns, so signup cannot set a subscription tier, an IMO, fleet counts or link fields whatever the calling code does. The organisation is a profile, carries no listing, and an admin must approve membership before it means anything.",
      risk: "low",
      test: "supabase/tests/data_quality/dq_i_restricted_paths_smoke.sql",
    } },
  { id: "forms.trigger", label: "Every authenticated member write (database trigger, shadow until enforced)", tables: ["cargo_listings", "vessel_availability", "vessels"], channel: "forms", policy: "draft",
    file: "supabase/migrations/20260917120000_cargo_live_route_gate.sql", marker: "trg_cl_zz_dq_gate" },
  { id: "forms.refusal", label: "Refused member post reported with its correlation id (own transaction)", tables: ["cargo_listings", "vessel_availability", "vessels"], channel: "forms", policy: "draft",
    file: "lib/dq/member-gate.ts", marker: "reportGateRefusal(" },
  { id: "forms.port.autocomplete", label: "Port added from Post Cargo (port autocomplete)", tables: ["ports"], channel: "forms", policy: "restricted",
    file: "components/cargo/PortAutocomplete.tsx", marker: "is_verified: false",
    exception: {
      owner: "Owner / IT (ASB admin console → Ports)",
      rationale: "Two limits, both enforced by the database rather than by this component. `ports` carries no INSERT policy for the authenticated role — only `ports: admin all` (fn_is_admin()) — so an ordinary member's insert is refused by row-level security and this path is reachable by an admin alone. And the row it writes is is_verified = false, while the member read policy is is_verified = true: the port is invisible to members until Admin → Ports verifies it, which IS gated strictly (admin.ports).",
      risk: "low",
      test: "supabase/tests/data_quality/dq_i_restricted_paths_smoke.sql",
    } },
  { id: "forms.port.availability", label: "Port added from Post Position (availability form)", tables: ["ports"], channel: "forms", policy: "restricted",
    file: "components/vessels/AvailabilityForm.tsx", marker: "is_verified: false",
    exception: {
      owner: "Owner / IT (ASB admin console → Ports)",
      rationale: "As forms.port.autocomplete: row-level security admits admins only, and the row is written unverified, so it cannot reach a member until Admin → Ports publishes it through the strict gate.",
      risk: "low",
      test: "supabase/tests/data_quality/dq_i_restricted_paths_smoke.sql",
    } },
  // ── publication ────────────────────────────────────────────────────────────
  { id: "review.approve", label: "Review-queue approval", tables: ["cargo_listings", "vessel_availability"], channel: "review", policy: "publication",
    file: "app/(admin)/admin/queue/actions.ts", marker: "{ strict: true }" },
  { id: "sync.stage", label: "Data Sync staging (workbook, circulars, WhatsApp)", tables: ["cargo_listings", "vessels", "vessel_availability", "ports", "commodities", "organizations", "sync_staged_row"], channel: "sync", policy: "draft",
    file: "lib/sync/stage.ts", marker: "fn_dq_gate_batch" },
  { id: "sync.commit", label: "Data Sync commit", tables: ["cargo_listings", "vessels", "vessel_availability", "ports", "commodities", "organizations"], channel: "sync", policy: "publication",
    file: "supabase/migrations/20260918130000_sync_phase3_gate_mandatory.sql", marker: "GATE_STALE" },
  { id: "sync.console", label: "Data Sync console (commit, undo, re-gate, staged-row flags, Manual Review)", tables: ["cargo_listings", "vessels", "vessel_availability", "ports", "commodities", "organizations", "sync_staged_row"], channel: "sync", policy: "publication",
    file: "app/(admin)/admin/data-sync/actions.ts", marker: "commit_sync_batch" },
  { id: "admin.edit", label: "Database Preview edit / insert / bulk edit", tables: ["cargo_listings", "vessels", "vessel_availability", "ports", "commodities", "organizations"], channel: "admin", policy: "publication",
    file: "supabase/migrations/20260918130000_sync_phase3_gate_mandatory.sql", marker: "set_config('dq.channel', 'admin', true)" },
  { id: "admin.fix", label: "Data Quality fix", tables: ["cargo_listings", "vessels", "vessel_availability", "ports", "commodities", "organizations", "market_names", "sync_staged_row"], channel: "admin", policy: "publication",
    file: "supabase/migrations/20260919110000_dq_d_fix_undo_safety.sql", marker: "could not be evaluated on this row" },
  { id: "admin.fix.actions", label: "Data Quality console (fix, bulk fix, undo)", tables: ["cargo_listings", "vessels", "vessel_availability", "ports", "commodities", "organizations", "market_names", "sync_staged_row"], channel: "admin", policy: "publication",
    file: "app/(admin)/admin/data-quality/actions.ts", marker: "dq_apply_fix" },
  { id: "admin.undo", label: "Data Quality undo (force is an override)", tables: ["cargo_listings", "vessels", "vessel_availability", "ports", "commodities", "organizations"], channel: "admin", policy: "override",
    file: "supabase/migrations/20260919110000_dq_d_fix_undo_safety.sql", marker: "a reason is required to force an undo" },
  { id: "admin.ports", label: "Admin → Ports (verify, activate, edit, create)", tables: ["ports"], channel: "admin", policy: "publication",
    file: "app/(admin)/admin/ports/actions.ts", marker: "{ strict: true, idColumn: \"locode\", what: \"port\" }",
    note: "is_verified = true IS the publication (the member read policy is is_verified = true), so verifying, activating, creating and editing a verified port are judged strictly on the admin channel and fail closed. Un-publishing and editing an unverified port are evaluated and logged only" },
  { id: "admin.commodities", label: "Admin → Commodities (activate, edit, create, reorder)", tables: ["commodities"], channel: "admin", policy: "publication",
    file: "app/(admin)/admin/commodities/actions.ts", marker: "{ strict: true, what: \"commodity\" }",
    note: "is_active = true IS the publication; activating, creating and editing an active commodity are strict and fail closed. Deactivating and reordering are evaluated and logged only" },
  { id: "admin.cargo.status", label: "Admin → Cargo status change (back on the market, or withdrawn)", tables: ["cargo_listings"], channel: "admin", policy: "publication",
    file: "app/(admin)/admin/cargo/actions.ts", marker: "{ strict: publishing, what: \"listing\" }",
    note: "IN / PARTIAL is a publication: judged strictly on the admin channel, fails closed, and the write carries the judged status as a precondition. OUT / CLOSED is a withdrawal: evaluated and logged, never refused" },
  { id: "admin.position.status", label: "Admin → Vessel positions status change", tables: ["vessel_availability"], channel: "admin", policy: "publication",
    file: "app/(admin)/admin/vessel-availability/actions.ts", marker: "{ strict: publishing, what: \"position\" }",
    note: "OPEN is a publication: strict, fails closed. FIXED / ON SUBS / INACTIVE is a withdrawal: evaluated and logged, never refused" },
  { id: "admin.vessels.particulars", label: "Admin → Vessel register, the vessel's own particulars (name, IMO, deadweight, flag, certificates)", tables: ["vessels"], channel: "admin", policy: "publication",
    file: "app/(admin)/admin/vessels/actions.ts", marker: '"particulars", true',
    note: "the fields listings are built from, judged as strictly here as Database Preview judges them (admin.edit)" },
  { id: "admin.vessels.flags", label: "Admin → Vessel register, internal annotations (risk level, scope, sanctions, notes, record review)", tables: ["vessels"], channel: "admin", policy: "draft",
    file: "app/(admin)/admin/vessels/actions.ts", marker: '"sanctions flag", false',
    note: "evaluated and logged on the admin channel, never refused: an administrator must be able to mark a vessel sanctioned or in review whatever the rules say about the row" },
  { id: "review.vessel", label: "Manual Review → vessel sync", tables: ["vessels", "vessel_availability"], channel: "review", policy: "publication",
    file: "app/(admin)/admin/data-sync/actions.ts", marker: "resolve_vessel_review" },
  { id: "review.commodity", label: "Manual Review → commodity mapping", tables: ["commodities"], channel: "review", policy: "publication",
    file: "app/(admin)/admin/data-sync/actions.ts", marker: "review gate: commodity" },
  { id: "review.port", label: "Manual Review → port placement", tables: ["ports"], channel: "review", policy: "publication",
    file: "app/(admin)/admin/data-sync/actions.ts", marker: "review gate: port" },
  { id: "pipeline.stage", label: "Circular pipeline staging (email, WhatsApp)", tables: ["cargo_listings", "vessels", "vessel_availability"], channel: "pipeline", policy: "draft",
    file: "lib/sync/stage.ts", marker: "gateChannelFor(source.kind)" },
  // ── planned ────────────────────────────────────────────────────────────────
  { id: "api.partner", label: "Partner API (not built)", tables: ["cargo_listings", "vessel_availability"], channel: "api", policy: "publication", planned: true,
    file: "supabase/migrations/20260918130000_sync_phase3_gate_mandatory.sql", marker: "dq.channel" },
];

/**
 * SECURITY DEFINER functions that write registered tables without naming a
 * channel themselves. Each says who gates the write:
 *   trigger-forms  called by a signed-in member through PostgREST: the gate
 *                  trigger sees the member's claims and judges it on the
 *                  forms channel (shadow until enforced)
 *   app-gated      called by the application on the service role after a
 *                  strict gate (validateRow { strict: true } / fn_dq_gate_batch)
 *   staging        writes the staging table only; the commit is gated
 *   internal       a helper reached only from a gated path
 *   self           the function evaluates the rules on the row itself
 *   erase          deletion, undo or anonymisation: restores or removes,
 *                  never introduces a new value — no rule applies
 */
export const DQ_SQL_WRITERS: { fn: string; gate: "trigger-forms" | "app-gated" | "staging" | "internal" | "self" | "erase"; why: string }[] = [
  { fn: "dq_apply_fix", gate: "self", why: "runs fn_dq_validate on the fixed row (strict: 'could not be evaluated on this row' refuses); audited; undoable" },
  { fn: "dq_undo_fix", gate: "self", why: "restores the fix's before-value only while the field still holds the fix; force needs a reason (override policy)" },
  { fn: "delete_live_record", gate: "erase", why: "Database Preview delete; audited in record_edit_audit" },
  { fn: "bulk_delete_live_records", gate: "erase", why: "Database Preview bulk delete; audited" },
  { fn: "undo_record_edits", gate: "erase", why: "reverses audited edits to their recorded before-values" },
  { fn: "create_cargo_listing", gate: "trigger-forms", why: "member RPC; trg_cl_zz_dq_gate judges the row on the forms channel" },
  { fn: "create_cargo_listing_v2", gate: "trigger-forms", why: "member RPC; trg_cl_zz_dq_gate" },
  { fn: "create_vessel_availability", gate: "trigger-forms", why: "member RPC; trg_va_zz_dq_gate" },
  { fn: "create_vessel_position", gate: "trigger-forms", why: "member RPC; trg_va_zz_dq_gate / trg_v_zz_dq_gate" },
  { fn: "register_vessel", gate: "trigger-forms", why: "member RPC; trg_v_zz_dq_gate" },
  { fn: "fn_position_checkin", gate: "trigger-forms", why: "member RPC (My Vessels check-in); trg_va_zz_dq_gate" },
  { fn: "resolve_vessel_review", gate: "app-gated", why: "Manual Review; strict validateRow before the call (review gate: vessel)" },
  { fn: "resolve_commodity_review", gate: "app-gated", why: "Manual Review; review gate: commodity" },
  { fn: "sync_vessel_positions", gate: "app-gated", why: "Manual Review vessel sync; review.vessel" },
  { fn: "commit_sync_batch", gate: "app-gated", why: "refuses rows gated under older rules (GATE_STALE); fn_dq_gate_batch gated the batch" },
  { fn: "undo_sync_batch", gate: "erase", why: "reverses a commit; restores the previous state, no new values" },
  { fn: "fn_dq_gate_batch", gate: "staging", why: "writes the gate verdict onto sync_staged_row; it IS the gate" },
  { fn: "fn_link_organization", gate: "internal", why: "organisation linking inside the sync commit / review paths" },
  { fn: "fn_upsert_contact", gate: "internal", why: "contact upsert inside the sync commit / review paths" },
  { fn: "fn_vrq_bind_contacts", gate: "internal", why: "binds review-queue contacts to listings after a gated resolve" },
  { fn: "gdpr_erase_contact", gate: "erase", why: "anonymisation on erasure; no rule applies" },
];

export const POLICY_LABEL: Record<DqPolicy, string> = {
  draft: "draft — evaluated, issues collected, nothing refused",
  publication: "publication — strict, fails closed",
  override: "override — named actor, reason, event record",
  restricted: "restricted — not a publication, and limited in what it can write (owner, reason, risk and test on record)",
  ungated: "ungated — nothing evaluates it and nothing limits it (none may exist)",
};
