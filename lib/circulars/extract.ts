// Pure helpers for the AI circular parser route: spreadsheet flattening and
// the HARD output guardrail (whitelist + clip). Kept free of Next.js imports
// so they can be unit-tested directly (npx tsx).

import * as XLSX from "xlsx";
import {
  ALLOWED_EXTRACT_FIELDS,
  OFF_TOPIC_WARNING,
  type CircularKind,
  type CircularParseResult,
} from "./types";

export const MAX_SHEET_LINES = 3_000; // converted spreadsheet rows fed to the model

/** Pull the first balanced JSON object out of the model output, tolerating
 *  any stray prose or code fences. */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model output");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/** Flatten a Q88 / circular spreadsheet into "item | question | answers" lines.
 *  cellDates:true turns date-formatted cells into real dates (Q88s are full of
 *  Excel serials that would otherwise read as opaque integers). */
export function spreadsheetToText(base64: string): string {
  const wb = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer", cellDates: true });
  const lines: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null });
    if (wb.SheetNames.length > 1) lines.push(`=== SHEET: ${name} ===`);
    for (const row of rows) {
      const cells = row
        .map((c) => {
          if (c == null || c === "") return null;
          if (c instanceof Date) return c.toISOString().slice(0, 10);
          return String(c).replace(/\s+/g, " ").trim();
        })
        .filter((c): c is string => !!c);
      if (cells.length) lines.push(cells.join(" | "));
      if (lines.length >= MAX_SHEET_LINES) break;
    }
    if (lines.length >= MAX_SHEET_LINES) break;
  }
  return lines.join("\n");
}

// ── HARD GUARDRAIL: sanitize the model output before it reaches the client ──
// Only whitelisted extracted fields survive, every string is clipped, and the
// envelope (kind/confidence/warnings/raw_intent) is normalised. Even a fully
// manipulated model cannot make the assistant say anything outside this shape.
const clip = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

export function sanitizeResult(raw: unknown): CircularParseResult {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const kind: CircularKind = obj.kind === "cargo" || obj.kind === "vessel" ? obj.kind : "unknown";
  const confidence =
    typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
      ? Math.min(1, Math.max(0, obj.confidence))
      : 0;

  const extractedRaw = (obj.extracted && typeof obj.extracted === "object" ? obj.extracted : {}) as Record<string, unknown>;
  const extracted: Record<string, unknown> = {};
  for (const [key, fieldKind] of Object.entries(ALLOWED_EXTRACT_FIELDS)) {
    const v = extractedRaw[key];
    if (v == null) continue;
    switch (fieldKind) {
      case "string": {
        if (typeof v !== "string") break;
        const s = clip(v, key === "notes" ? 600 : 160);
        if (s) extracted[key] = s;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
        if (Number.isFinite(n)) extracted[key] = n;
        break;
      }
      case "boolean": {
        if (typeof v === "boolean") extracted[key] = v;
        break;
      }
      case "string[]": {
        if (Array.isArray(v)) {
          const arr = v
            .filter((x): x is string => typeof x === "string")
            .map((x) => clip(x, 40))
            .filter(Boolean)
            .slice(0, 20);
          if (arr.length) extracted[key] = arr;
        }
        break;
      }
    }
  }

  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings
        .filter((w): w is string => typeof w === "string")
        .map((w) => clip(w, 200))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  // Off-topic / empty extractions collapse to the fixed refusal shape.
  if (kind === "unknown" && Object.keys(extracted).length === 0) {
    return { kind: "unknown", confidence: 0, extracted: {}, warnings: [OFF_TOPIC_WARNING], raw_intent: "off-topic input" };
  }

  return {
    kind,
    confidence,
    extracted: extracted as CircularParseResult["extracted"],
    warnings,
    raw_intent: typeof obj.raw_intent === "string" ? clip(obj.raw_intent, 300) : "",
  };
}
