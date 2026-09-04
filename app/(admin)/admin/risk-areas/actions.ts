"use server";

// Risk areas — admin-drawn war / high-risk / advisory polygons. Every route
// drawn on the market map that crosses an active area raises an
// insurance-premium alert (lib/portal/risk-areas.ts).
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type Result<T = void> = { success: true; data: T } | { success: false; error: string };

export interface RiskAreaInput {
  id?: string | null;
  name: string;
  severity: "war_zone" | "high_risk" | "advisory";
  alertText: string | null;
  polygon: [number, number][];
  isActive: boolean;
  notes: string | null;
}

export interface RiskAreaRow {
  id: string;
  name: string;
  severity: "war_zone" | "high_risk" | "advisory";
  alert_text: string | null;
  polygon: [number, number][];
  is_active: boolean;
  notes: string | null;
  updated_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validate(input: RiskAreaInput): string | null {
  if (!input.name?.trim()) return "The area needs a name.";
  if (!["war_zone", "high_risk", "advisory"].includes(input.severity)) return "Unknown severity.";
  const poly = Array.isArray(input.polygon) ? input.polygon : [];
  if (poly.length < 3) return "Draw at least three points.";
  for (const p of poly) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return "The shape has an invalid point.";
    if (p[0] < -90 || p[0] > 90 || p[1] < -180 || p[1] > 180) return "A point is outside the world.";
  }
  return null;
}

function afterWrite() {
  revalidatePath("/admin/risk-areas");
  revalidatePath("/dashboard", "layout");
}

export async function listRiskAreas(): Promise<RiskAreaRow[]> {
  await requireAdmin({ section: "risk" });
  const c = getSupabaseAdminClient();
  const { data, error } = await c
    .from("risk_areas")
    .select("id, name, severity, alert_text, polygon, is_active, notes, updated_at")
    .order("severity")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as RiskAreaRow[];
}

export async function saveRiskArea(input: RiskAreaInput): Promise<Result<{ id: string }>> {
  try {
    const u = await requireAdmin({ section: "risk", edit: true });
    const err = validate(input);
    if (err) return { success: false, error: err };
    const c = getSupabaseAdminClient();
    const row = {
      name: input.name.trim(),
      severity: input.severity,
      alert_text: input.alertText?.trim() || null,
      polygon: input.polygon.map((p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]),
      is_active: !!input.isActive,
      notes: input.notes?.trim() || null,
    };
    if (input.id && UUID_RE.test(input.id)) {
      const { error } = await c.from("risk_areas").update(row).eq("id", input.id);
      if (error) return { success: false, error: error.message };
      afterWrite();
      return { success: true, data: { id: input.id } };
    }
    const { data, error } = await c.from("risk_areas").insert({ ...row, created_by: u.rowId }).select("id").single();
    if (error) return { success: false, error: error.message };
    afterWrite();
    return { success: true, data: { id: data.id as string } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not save the area." };
  }
}

export async function deleteRiskArea(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid id." };
  try {
    await requireAdmin({ section: "risk", edit: true });
    const c = getSupabaseAdminClient();
    const { error } = await c.from("risk_areas").delete().eq("id", id);
    if (error) return { success: false, error: error.message };
    afterWrite();
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not delete the area." };
  }
}
