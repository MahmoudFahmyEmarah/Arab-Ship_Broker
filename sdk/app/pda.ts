import type { SupabaseClient } from "@supabase/supabase-js";

import type { PdaCalculationResult, PdaRequest, PdaTariffVersion } from "@/lib/pda/types";
import { parsePdaPortsWorkspace, type PdaPortsWorkspace } from "@/lib/pda/ports-workspace";
import { parsePdaPreferences, type PdaPreferences, type PdaStartTab } from "@/lib/pda/preferences";
import type { PdaEstimatorDensity } from "@/lib/pda/estimator-contract";

export interface PdaCoverageItem {
  portLocode: string;
  portName: string;
  terminalId: string | null;
  terminalName: string | null;
  tariffVersionId: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PdaCalculationContext {
  coverage: "published" | "manual_required";
  tariffVersion?: PdaTariffVersion | null;
  warning?: string;
}

export interface PdaTerminalItem {
  id: string;
  portLocode: string;
  name: string;
}

export async function listPdaCoverage(supabase: SupabaseClient, callDate: string): Promise<PdaCoverageItem[]> {
  const { data, error } = await supabase.rpc("list_pda_coverage", { p_call_date: callDate });
  if (error) throw new Error(error.message);
  return (data ?? []) as PdaCoverageItem[];
}

/** The Ports workspace (20261018100000): verified ports, their terminals and the tariffs in force on the call date. */
export async function listPdaPortsWorkspace(supabase: SupabaseClient, callDate: string): Promise<PdaPortsWorkspace> {
  const { data, error } = await supabase.rpc("list_pda_ports_workspace", { p_call_date: callDate });
  if (error) throw new Error(error.message);
  return parsePdaPortsWorkspace(data);
}

/** The caller's Setup preferences (20261018110000); defaults when none are saved. */
export async function getMyPdaPreferences(supabase: SupabaseClient): Promise<PdaPreferences> {
  const { data, error } = await supabase.rpc("get_my_pda_preferences");
  if (error) throw new Error(error.message);
  return parsePdaPreferences(data);
}

/** Saves the caller's own Setup preferences (validated in the database). */
export async function setMyPdaPreferences(supabase: SupabaseClient, density: PdaEstimatorDensity, startTab: PdaStartTab): Promise<PdaPreferences> {
  const { data, error } = await supabase.rpc("set_my_pda_preferences", { p_density: density, p_start_tab: startTab });
  if (error) throw new Error(error.message);
  return parsePdaPreferences(data);
}

export async function listPdaTerminals(supabase: SupabaseClient, portLocode?: string): Promise<PdaTerminalItem[]> {
  const { data, error } = await supabase.rpc("list_pda_terminals", { p_port_locode: portLocode ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as PdaTerminalItem[];
}

export async function getPdaCalculationContext(
  supabase: SupabaseClient,
  input: Pick<PdaRequest, "portLocode" | "terminalId" | "callDate">,
): Promise<PdaCalculationContext> {
  const { data, error } = await supabase.rpc("get_pda_calculation_context", {
    p_port_locode: input.portLocode,
    p_terminal_id: input.terminalId ?? null,
    p_call_date: input.callDate,
  });
  if (error) throw new Error(error.message);
  return data as PdaCalculationContext;
}

export async function savePdaEstimate(
  supabase: SupabaseClient,
  input: {
    actorId: string;
    ownerOrgId?: string | null;
    request: PdaRequest;
    result: PdaCalculationResult;
    supersedesId?: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("pda_save_estimate", {
    p_actor: input.actorId,
    p_owner_org_id: input.ownerOrgId ?? null,
    p_request: input.request,
    p_result: input.result,
    p_supersedes_id: input.supersedesId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getPdaEstimate(supabase: SupabaseClient, estimateId: string) {
  const { data, error } = await supabase.rpc("get_pda_estimate", { p_estimate_id: estimateId });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}
