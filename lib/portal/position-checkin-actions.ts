"use server";

// Server actions for the vessel position check-in popup (Pre_Final §13).
// getDuePosition: the caller's most-due OPEN position (overdue first, then
// nearest open date) with the vessel facts the popup shows. submitCheckin:
// confirm (no fields) or update (4 fields) via the ownership-enforcing RPC —
// both stamp position_confirmed_at, the trust signal.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getMyVesselAvailability } from "@/sdk/app/vessels";

export interface DuePosition {
  availabilityId: string;
  vesselName: string;
  vesselType: string;
  imo: string;
  openPort: string;
  openZone: string;
  openDate: string | null; // ISO date
  openDateDays: number | null; // negative = overdue
  urgency: "red" | "amber" | "green";
}

export async function getDuePosition(): Promise<DuePosition | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const rows = await getMyVesselAvailability(supabase);
    const open = rows.filter(
      (r) =>
        (r as { status?: string }).status === "OPEN" &&
        (r as { review_status?: string }).review_status === "APPROVED",
    );
    if (!open.length) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = (d: string | null | undefined) => {
      if (!d) return null;
      const t = new Date(d);
      t.setHours(0, 0, 0, 0);
      return Math.round((t.getTime() - today.getTime()) / 86400000);
    };

    // Most-due first: overdue (negative days), then nearest open date;
    // undated positions last.
    const sorted = open
      .map((r) => {
        const row = r as Record<string, unknown> & {
          vessel?: { vessel_name?: string; vessel_type?: string; imo_number?: string } | null;
        };
        return { row, d: days(row.open_date as string | null) };
      })
      .sort((a, b) => (a.d ?? 999) - (b.d ?? 999));

    const top = sorted[0];
    const row = top.row;
    const d = top.d;
    const urgency: DuePosition["urgency"] = d == null ? "green" : d < 0 ? "red" : d <= 3 ? "amber" : "green";

    return {
      availabilityId: String(row.id),
      vesselName: row.vessel?.vessel_name ?? "Vessel",
      vesselType: row.vessel?.vessel_type ?? "—",
      imo: row.vessel?.imo_number ?? "—",
      openPort: (row.open_port_name as string) ?? (row.open_port_locode as string) ?? "—",
      openZone: (row.open_zone as string) ?? "—",
      openDate: (row.open_date as string) ?? null,
      openDateDays: d,
      urgency,
    };
  } catch (err) {
    console.error("[checkin] getDuePosition failed:", err);
    return null;
  }
}

export async function submitCheckin(input: {
  availabilityId: string;
  etaPortLocode?: string;
  etaDate?: string;
  etaTime?: string;
  openDate?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.rpc("fn_position_checkin", {
      p_availability_id: input.availabilityId,
      p_eta_port_locode: input.etaPortLocode ?? null,
      p_eta_date: input.etaDate ?? null,
      p_eta_time: input.etaTime ?? null,
      p_open_date: input.openDate ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Check-in failed" };
  }
}
