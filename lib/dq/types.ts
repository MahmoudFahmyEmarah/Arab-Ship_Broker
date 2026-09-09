// Data Quality module — shared types (client-safe, no server imports).
// Mirrors the dq_* tables created in 20260908130000_data_quality.sql.

export type DqSeverity = "error" | "warn" | "info";
export type DqCategory =
  | "completeness" | "validity" | "referential" | "uniqueness" | "consistency"
  | "classification" | "business rule" | "freshness" | "compliance";
export type DqKind = "declarative" | "sql" | "classification" | "ai";
export type DqAutofix = "none" | "normalise" | "set from registry" | "reclassify" | "suggest only";
export type DqSource = "built-in" | "workbook" | "admin" | "AI-suggested";
export type DqChannel = "forms" | "admin" | "sync" | "review" | "pipeline" | "api";
export type DqMode = "block" | "warn" | "audit";
export type DqRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type DqRunMode = "rules" | "ai" | "both";
export type DqIssueStatus = "open" | "fixed" | "ignored" | "false_positive" | "escalated";

export const DQ_CATEGORIES: DqCategory[] = [
  "completeness", "validity", "referential", "uniqueness", "consistency", "classification", "business rule", "freshness", "compliance",
];
export const DQ_CHANNELS: { id: DqChannel; label: string; sub: string }[] = [
  { id: "forms", label: "Member forms", sub: "Post Cargo · Post Position · Register Vessel · My Vessels" },
  { id: "admin", label: "Admin edits", sub: "Database Preview · admin pages · DQ fixes" },
  { id: "sync", label: "Data Sync commit", sub: "workbook commit" },
  { id: "review", label: "Manual Review sync", sub: "Manual Review dialogs" },
  { id: "pipeline", label: "Circular pipeline", sub: "email · WhatsApp circulars" },
  { id: "api", label: "Partner API", sub: "partner writes" },
];

/** One check of a rule — bound to one table. SQL fragments are over alias `r`. */
export interface DqCheck {
  table: string;
  field?: string | null;
  violation_sql?: string | null;
  query_sql?: string | null;
  observed_sql?: string | null;
  expected_sql?: string | null;
  expected_text?: string | null;
  fix_sql?: string | null;
  fix_field?: string | null;
  fix_confidence?: number | null;
  fix_rationale?: string | null;
  message?: string | null;
  note?: string | null;
}

export interface DqRule {
  id: string;
  code: string;
  name: string;
  description: string;
  category: DqCategory;
  severity: DqSeverity;
  kind: DqKind;
  definition: string;
  checks: DqCheck[];
  ai_prompt: string | null;
  tables: string[];
  autofix: DqAutofix;
  enabled: boolean;
  source: DqSource;
  owner: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // computed by listRules
  stats?: { open: number; raised: number; fp: number; checked: number };
  channels?: Partial<Record<DqChannel, DqMode>>;
}

export interface DqRuleVersion {
  id: number;
  rule_id: string;
  version: number;
  snapshot: Partial<DqRule>;
  note: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

export interface DqTableInfo {
  table_name: string;
  label: string;
  key_column: string;
  admin_href: string | null;
  sort_order: number;
}

export interface DqScope {
  kind: "db" | "tables" | "filter";
  tables?: string[];
  filter?: "live" | "sync" | "open";
  batch_id?: string | null;
  batch_label?: string | null;
  counts?: { table: string; rows: number }[];
}

export interface DqRun {
  id: string;
  code: string;
  status: DqRunStatus;
  scope: DqScope;
  mode: DqRunMode;
  batch_size: number;
  rule_ids: string[] | null;
  tables: string[];
  total_rows: number;
  rows_done: number;
  total_batches: number;
  batches_done: number;
  found: { error: number; warn: number; info: number };
  ai_issues: number;
  tokens: number;
  cost: number;
  cursor: { idx: number; last: string | null };
  started_by_name: string | null;
  trigger: string;
  scheduled_for: string | null;
  notify: boolean;
  note: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_batch_at: string | null;
  duration_ms: number | null;
}

export interface DqRunBatch {
  id: string;
  run_id: string;
  n: number;
  table_name: string;
  key_from: string | null;
  key_to: string | null;
  rows: number;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  found: { error: number; warn: number; info: number };
  ai_tokens: number;
  ai_issues: number;
  ms: number | null;
  error: string | null;
}

export interface DqFix {
  field: string;
  value: string | null;
  before?: string | null;
  after?: string | null;
  rationale?: string | null;
  confidence?: number | null;
  kind?: string | null;
  applied_at?: string | null;
}

export interface DqIssue {
  id: string;
  rule_id: string | null;
  rule_code: string;
  run_id: string | null;
  table_name: string;
  row_key: string;
  row_label: string | null;
  field: string | null;
  observed: string | null;
  expected: string | null;
  severity: DqSeverity;
  category: string | null;
  source: "rule" | "ai";
  confidence: number | null;
  evidence: string | null;
  why: string | null;
  snapshot: Record<string, unknown> | null;
  fix: DqFix | null;
  status: DqIssueStatus;
  reason: string | null;
  assignee: string | null;
  fixed_audit_id: string | null;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
}

export interface DqSuggestion {
  id: string;
  kind: "rule" | "fix";
  status: "pending" | "accepted" | "dismissed";
  title: string;
  nl: string;
  sql: string | null;
  category: string | null;
  severity: DqSeverity | null;
  tables: string[];
  hits: number;
  evidence: string[];
  model: string | null;
  confidence: number | null;
  rule_code: string | null;
  issue_ids: string[];
  run_id: string | null;
  accepted_rule_id: string | null;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
}

export interface DqGateLogRow {
  id: number;
  at: string;
  channel: DqChannel;
  rule_code: string;
  table_name: string | null;
  row_key: string | null;
  actor: string | null;
  mode: DqMode;
  message: string | null;
  payload_hash: string | null;
}

export interface DqSettings {
  batch_size: number;
  ai_sample: number;
  ai_daily_tokens: number;
  ai_price_per_mtok: number;
  auto_apply_threshold: number;
  weights: { error: number; warn: number; info: number };
  nightly_enabled: boolean;
  nightly_time: string;
  nightly_mode: DqRunMode;
  notify: { recipients: string[]; on_complete: boolean; on_errors: boolean; digest: boolean; budget80: boolean };
  registry_release: string | null;
  registry_imported_at: string | null;
  version: number;
  updated_at: string;
}

export interface DqHealthTile {
  table: string;
  label: string;
  rows: number;
  open_error: number;
  open_warn: number;
  open_info: number;
  open: number;
  score: number;
  coverage: number;
  href: string | null;
  trend: number[]; // last 14 snapshots (oldest → newest), ending with the live score
}

export interface DqGateResult {
  ok: boolean;
  blocked: boolean;
  issues: { rule_code: string; name: string; severity: DqSeverity; field: string | null; mode: DqMode; message: string }[];
}

export interface DqDriftRow {
  locode: string;
  port: string | null;
  ours: string | null;
  registry: string | null;
  issue: string;
  status: string | null;
  action: string;
}

export interface DqPortException {
  locode: string;
  reason: string;
  requested_by_name: string | null;
  requested_at: string;
  status: "pending" | "approved" | "rejected";
  approved_by_name: string | null;
  approved_at: string | null;
}

export const SEVERITY_BADGE: Record<DqSeverity, string> = { error: "rejected", warn: "pending", info: "draft" };
export const MODE_BADGE: Record<DqMode, string> = { block: "rejected", warn: "pending", audit: "draft" };
export const SOURCE_BADGE: Record<DqSource, string> = { "built-in": "closed", workbook: "draft", admin: "tier", "AI-suggested": "amber" };
export const RUN_BADGE: Record<DqRunStatus, string> = { completed: "live", running: "closed", paused: "pending", queued: "draft", failed: "rejected", cancelled: "expired" };
export const ISSUE_BADGE: Record<DqIssueStatus, string> = { open: "rejected", fixed: "live", ignored: "expired", false_positive: "draft", escalated: "pending" };
export const ISSUE_LABEL: Record<DqIssueStatus, string> = { open: "open", fixed: "fixed", ignored: "ignored", false_positive: "false positive", escalated: "escalated" };
export const RUN_MODE_LABEL: Record<DqRunMode, string> = { rules: "rule-based", ai: "AI review", both: "rules + AI" };

export function scopeLabel(scope: DqScope, tableLabel: (t: string) => string): string {
  if (scope.kind === "db") return "Whole database";
  if (scope.kind === "tables") return (scope.tables ?? []).map(tableLabel).join(" · ") || "Selected tables";
  if (scope.filter === "live") return "Live cargo + open positions";
  if (scope.filter === "open") return "Open positions";
  if (scope.filter === "sync") return `Last sync batch${scope.batch_label ? ` (${scope.batch_label})` : ""}`;
  return "Filtered";
}
