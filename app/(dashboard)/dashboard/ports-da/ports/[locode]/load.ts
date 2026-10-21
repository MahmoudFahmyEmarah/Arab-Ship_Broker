// The one loader behind the per-port pages (record, settings): the port and its tariffs in force, the packs that price
// it and the agencies listed at it, all through the member's own session. An unknown code is "missing" (said out loud by
// the page, never answered with another port); a read error is "failed".
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PdaAgency } from "@/lib/pda/agents";
import { isPdaPortLocode, type PdaPortRecordInput } from "@/lib/pda/port-record";
import { listPdaPortAgents, listPdaPortsWorkspace, listPdaTariffPacks } from "@/sdk/app/pda";

export type PortRecordLoad = { kind: "ok"; input: PdaPortRecordInput } | { kind: "missing" } | { kind: "failed" };

export async function loadPortRecordInput(supabase: SupabaseClient, locode: string, on: string): Promise<PortRecordLoad> {
  if (!isPdaPortLocode(locode)) return { kind: "missing" };
  try {
    const workspace = await listPdaPortsWorkspace(supabase, on);
    const port = workspace.ports.find((p) => p.locode === locode) ?? null;
    if (!port) return { kind: "missing" };
    const packs = await listPdaTariffPacks(supabase, on);
    // the agency registry ships with the Agents wave; before it, the section says so instead of failing the page
    let agents: PdaAgency[] | null;
    try {
      agents = await listPdaPortAgents(supabase, locode);
    } catch {
      agents = null;
    }
    return { kind: "ok", input: { port, packs, agents, on } };
  } catch {
    return { kind: "failed" };
  }
}
