// Data Quality — AI review. The model reads a PII-masked sample of a batch
// together with the rules that apply to the table and general data-quality
// heuristics, and returns proposed issues (with confidence + evidence) and
// proposed rules. It never writes: the caller stores proposals for an admin.
// Every call is metered (tokens → dq_ai_usage) through the vendor-agnostic
// Vault credential (getActiveModel).
import type { SupabaseClient } from "@supabase/supabase-js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getActiveModel } from "@/lib/sync/email/llm";
import { isTransientAiError, withDeadline } from "./ai-budget";
import type { DqRule, DqSeverity } from "./types";

export interface AiIssue {
  row_key: string;
  field: string | null;
  observed: string | null;
  expected: string | null;
  severity: DqSeverity;
  category: string;
  why: string;
  evidence: string | null;
  confidence: number;
  rule_code: string | null;
  fix_value: string | null;
}
export interface AiRuleProposal {
  title: string;
  nl: string;
  sql: string | null;
  category: string;
  severity: DqSeverity;
  confidence: number;
}
export interface AiReviewResult {
  issues: AiIssue[];
  suggestedRules: AiRuleProposal[];
  tokens: number;
  model: string;
  vendor: string;
  /** the reply was not parseable JSON — tokens were spent, nothing was learned (audit C8) */
  parseFailed: boolean;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// A phone has a phone-shaped prefix: an international "+"/"00", or a
// tel / mob / whatsapp label in front. Bare digit runs are left alone — the
// old greedy pattern masked "laycan 12-18.10.2026" to "laycan [phone]" and the
// model was then asked to check dates it could not see (audit C4). PII
// columns are already dropped in the database; this is the second belt.
const PHONE_RE = /(?:(?:\+|\b00)\d[\d\s().-]{6,}\d|(?<=\b(?:tel|mob|mobile|phone|whatsapp|wa|cell|call)\.?\s*:?\s*)\+?\d[\d\s().-]{6,}\d)/gi;

/** Belt-and-braces masking: PII columns were already dropped in the DB (fn_dq_sample_rows); this scrubs free text. */
export function maskPii(v: unknown): unknown {
  if (typeof v === "string") return v.replace(EMAIL_RE, "[email]").replace(PHONE_RE, (m) => (/\d{7,}/.test(m.replace(/\D/g, "")) ? "[phone]" : m));
  if (Array.isArray(v)) return v.map(maskPii);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskPii(x)]));
  return v;
}

const GENERAL_HEURISTICS = [
  "Completeness: required business fields present (keys, quantities, dates, ports, commodity, type).",
  "Validity: formats and ranges — UN/LOCODE is 5 chars (2 letters + 3), IMO is 7 digits with check digit, commission 0–10 %, zones in the platform enum, dates ordered (laycan from ≤ to, open date plausible).",
  "Referential integrity: codes should exist in their registries (ports, flag states, commodities, IMSBC names).",
  "Consistency: cross-field agreement — packaging words ('bags', 'big bags', 'pallets') imply Break Bulk / CSS; grain-list items in bulk imply GRAIN; meals, cakes, pellets and bran are IMSBC SEED CAKE Group B (never grain); finished steel is break-bulk; iron ore is IMSBC never GRAIN; quantities vs stowage factor vs cubic; DWT vs cubic vs LOA for the vessel type.",
  "Classification: IMSBC groups are A (may liquefy), B (chemical hazard), C (neither); 'Non-DG' is not a group; UN numbers apply to packaged (CSS) cargo or listed BCSNs.",
  "Freshness: live listings older than 7 days, positions with an open date far in the past.",
  "Text vs structured: free text (notes, names) contradicting a structured field (e.g. 'cbm' quantities stored as mt, 'ex Novorossiysk' with a different load port).",
];

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? "")).join("\n");
  return String(content ?? "");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{"); const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("The model returned no JSON object.");
  return JSON.parse(body.slice(start, end + 1));
}

const SEVS = new Set<string>(["error", "warn", "info"]);
const clamp01 = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));
const str = (v: unknown, max = 600): string | null => (v == null || v === "" ? null : String(v).slice(0, max));

export async function runAiReview(
  sb: SupabaseClient,
  input: { table: string; tableLabel: string; rows: Record<string, unknown>[]; rules: Pick<DqRule, "code" | "name" | "description" | "ai_prompt" | "kind" | "severity">[]; maxOutputTokens?: number; knownColumns?: string[] },
): Promise<AiReviewResult> {
  const { model, vendor, modelName } = await getActiveModel(sb, { maxOutputTokens: input.maxOutputTokens });
  const rows = input.rows.map((r) => maskPii(r)) as Record<string, unknown>[];
  const columns = input.knownColumns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((k) => !k.startsWith("__"));

  const system = [
    "You are the data-quality reviewer for Arab ShipBroker, a dry-cargo chartering marketplace (Gulf, Red Sea, Mediterranean, Black Sea).",
    "You receive a sample of rows from one database table, the deterministic rules that already apply to that table, and general data-quality heuristics.",
    "Find issues the rules miss or cannot see, and propose new deterministic rules when you notice a repeatable pattern.",
    "You never write to the database. Be precise, cite the row by its __key, and give a confidence between 0 and 1. Prefer fewer, well-evidenced findings over many weak ones.",
    "Return ONLY a JSON object of this exact shape:",
    '{"issues":[{"row_key":"<__key>","field":"<column or null>","observed":"<value seen>","expected":"<value or description>","severity":"error|warn|info","category":"completeness|validity|referential|uniqueness|consistency|classification|business rule|freshness|compliance","why":"<one sentence>","evidence":"<short quote from the row>","confidence":0.0,"rule_code":"<existing DQ code if it should have fired, else null>","fix_value":"<exact replacement value for field, or null>"}],',
    '"suggested_rules":[{"title":"<short>","nl":"<plain-language rule>","sql":"select * from <table> where <condition>","category":"...","severity":"error|warn|info","confidence":0.0}]}',
    "Severity: error blocks the market, warn is visible but allowed, info is advisory. fix_value must be a value that can be written directly into the field (no explanations).",
  ].join("\n");

  const human = [
    `Table: ${input.table} (${input.tableLabel}). Columns: ${columns.join(", ")}.`,
    "",
    "Rules already applied to this table:",
    ...input.rules.map((r) => `- ${r.code} [${r.severity}] ${r.name}: ${r.description}${r.kind === "ai" && r.ai_prompt ? ` AI check: ${r.ai_prompt}` : ""}`),
    "",
    "General heuristics:",
    ...GENERAL_HEURISTICS.map((h) => `- ${h}`),
    "",
    `Sample rows (${rows.length}, PII masked):`,
    JSON.stringify(rows),
  ].join("\n");

  // workstream F: a 90 s deadline, one retry on a transient failure, never on a refusal
  const call = () => withDeadline(model.invoke([new SystemMessage(system), new HumanMessage(human)]), 90_000, "AI review");
  let res;
  try { res = await call(); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isTransientAiError(msg)) throw e;
    await new Promise((r) => setTimeout(r, 2_000));
    res = await call();
  }
  const text = contentToText(res.content);
  const usage = (res as { usage_metadata?: { total_tokens?: number; input_tokens?: number; output_tokens?: number } }).usage_metadata;
  const tokens = (usage?.total_tokens ?? ((usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0))) || Math.ceil((system.length + human.length + text.length) / 4);

  let parsed: { issues?: unknown[]; suggested_rules?: unknown[] } = {};
  let parseFailed = false;
  try { parsed = extractJson(text) as typeof parsed; } catch { parsed = {}; parseFailed = true; }

  const keys = new Set(rows.map((r) => String(r.__key)));
  const cols = new Set(columns);
  const ruleCodes = new Set(input.rules.map((r) => r.code));
  const issues: AiIssue[] = [];
  for (const raw of (Array.isArray(parsed.issues) ? parsed.issues : []) as Record<string, unknown>[]) {
    const key = String(raw.row_key ?? "");
    if (!keys.has(key)) continue;
    const field = raw.field == null ? null : String(raw.field);
    const sev = SEVS.has(String(raw.severity)) ? (String(raw.severity) as DqSeverity) : "warn";
    issues.push({
      row_key: key,
      field: field && cols.has(field) ? field : null,
      observed: str(raw.observed, 300),
      expected: str(raw.expected, 300),
      severity: sev,
      category: str(raw.category, 40) ?? "consistency",
      why: str(raw.why) ?? "Flagged by AI review.",
      evidence: str(raw.evidence, 400),
      confidence: clamp01(raw.confidence),
      rule_code: raw.rule_code && ruleCodes.has(String(raw.rule_code)) ? String(raw.rule_code) : null,
      fix_value: field && cols.has(field) ? str(raw.fix_value, 300) : null,
    });
  }
  const suggestedRules: AiRuleProposal[] = [];
  for (const raw of (Array.isArray(parsed.suggested_rules) ? parsed.suggested_rules : []) as Record<string, unknown>[]) {
    const title = str(raw.title, 120); if (!title) continue;
    suggestedRules.push({
      title, nl: str(raw.nl, 800) ?? title, sql: str(raw.sql, 2000),
      category: str(raw.category, 40) ?? "consistency",
      severity: SEVS.has(String(raw.severity)) ? (String(raw.severity) as DqSeverity) : "warn",
      confidence: clamp01(raw.confidence),
    });
  }
  return { issues, suggestedRules, tokens, model: modelName, vendor , parseFailed };
}
