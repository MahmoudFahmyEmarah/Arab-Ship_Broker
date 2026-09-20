// Server-side validation of Data Quality settings (workstream E, 19 Sep 2026).
// The console used to accept any value and clamp only the batch size.

import type { DqSettings } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Problems with a settings patch, in the words the console shows. Empty = fine. */
export function settingsProblems(patch: Partial<DqSettings>): string[] {
  const out: string[] = [];
  const num = (k: keyof DqSettings, min: number, max: number, what: string) => {
    const v = patch[k];
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v)) { out.push(`${what} must be a number.`); return; }
    if (v < min || v > max) out.push(`${what} must be between ${min.toLocaleString()} and ${max.toLocaleString()}.`);
  };
  num("batch_size", 100, 5000, "Batch size");
  num("ai_sample", 5, 200, "AI sample");
  num("ai_daily_tokens", 0, 50_000_000, "Daily AI token budget");
  num("ai_price_per_mtok", 0, 1000, "AI price per million tokens");
  num("ai_max_output_tokens", 256, 32_000, "AI reply cap (output tokens)");
  num("auto_apply_threshold", 0, 1, "Auto-apply threshold");
  if (patch.nightly_time !== undefined && !HHMM.test(String(patch.nightly_time))) out.push("Nightly time must be HH:MM (24-hour UTC).");
  if (patch.nightly_mode !== undefined && !["rules", "ai", "both"].includes(String(patch.nightly_mode))) out.push("Nightly mode must be rules, ai or both.");
  if (patch.weights !== undefined) {
    const w = patch.weights as Partial<Record<"error" | "warn" | "info", unknown>> | null;
    for (const k of ["error", "warn", "info"] as const) {
      const v = w?.[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) out.push(`Health weight for ${k} must be a number of 0 or more.`);
    }
    if (typeof w?.error === "number" && w.error <= 0) out.push("Health weight for error must be above 0 (it is the divisor of the score).");
  }
  if (patch.notify !== undefined) {
    const n = patch.notify as { recipients?: unknown } | null;
    const rec = Array.isArray(n?.recipients) ? (n!.recipients as unknown[]) : null;
    if (!rec) out.push("Notification recipients must be a list.");
    else for (const r of rec) if (typeof r !== "string" || !EMAIL.test(r)) out.push(`"${String(r)}" is not an email address.`);
  }
  return out;
}
