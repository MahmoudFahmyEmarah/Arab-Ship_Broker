import type { SupabaseClient } from "@supabase/supabase-js";

import type { PdaCalculationResult, PdaRequest, PdaTariffVersion } from "@/lib/pda/types";
import { parsePdaPortsWorkspace, type PdaPortsWorkspace } from "@/lib/pda/ports-workspace";
import { parsePdaPreferences, type PdaPreferences, type PdaStartTab } from "@/lib/pda/preferences";
import { parsePdaAdminAgencies, parsePdaAgencies, type PdaAdminAgency, type PdaAgency } from "@/lib/pda/agents";
import { parsePdaAgencyInbox, parsePdaQuoteRequests, type PdaAgencyInboxItem, type PdaQuoteRequest } from "@/lib/pda/quote-requests";
import { parsePdaQuoteAcceptanceContext, type PdaQuoteAcceptanceContext } from "@/lib/pda/quote-acceptance";
import { parsePdaDeskQuoteRequests, type PdaDeskQuoteRequest } from "@/lib/pda/desk-quotes";
import {
  parsePdaSaveSetResult,
  parsePdaSetDetail,
  parsePdaSetSummaries,
  type PdaEstimateSetDetail,
  type PdaEstimateSetSummary,
  type PdaRouteSnapshot,
  type PdaSaveSetResult,
} from "@/lib/pda/estimate-sets";
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

/** Saves one route as an immutable set (20261018120000). SERVICE ROLE client only: the RPC has no member grant. */
export async function savePdaEstimateSet(
  admin: SupabaseClient,
  input: {
    actorId: string;
    ownerOrgId: string | null;
    loadRequest: PdaRequest;
    loadResult: PdaCalculationResult;
    dischargeRequest: PdaRequest;
    dischargeResult: PdaCalculationResult;
    route: PdaRouteSnapshot;
    supersedesId: string | null;
  },
): Promise<PdaSaveSetResult> {
  const { data, error } = await admin.rpc("pda_save_estimate_set", {
    p_actor: input.actorId,
    p_owner_org_id: input.ownerOrgId,
    p_load_request: input.loadRequest,
    p_load_result: input.loadResult,
    p_discharge_request: input.dischargeRequest,
    p_discharge_result: input.dischargeResult,
    p_route: input.route,
    p_supersedes_id: input.supersedesId,
  });
  if (error) throw new Error(error.message);
  return parsePdaSaveSetResult(data);
}

/** The caller's own saved sets and their organisation's, newest first. */
export async function listMyPdaEstimateSets(supabase: SupabaseClient, before?: string | null, limit = 20): Promise<PdaEstimateSetSummary[]> {
  const { data, error } = await supabase.rpc("list_my_pda_estimate_sets", { p_limit: limit, p_before: before ?? null });
  if (error) throw new Error(error.message);
  return parsePdaSetSummaries(data);
}

/** One saved set with both legs (owner, active organisation seat or admin). */
export async function getPdaEstimateSet(supabase: SupabaseClient, setId: string): Promise<PdaEstimateSetDetail> {
  const { data, error } = await supabase.rpc("get_pda_estimate_set", { p_set_id: setId });
  if (error) throw new Error(error.message);
  return parsePdaSetDetail(data);
}

/** Active, ASB-invited agencies at active verified ports (Agents phase 1, 20261018130000); one port when given. */
export async function listPdaPortAgents(supabase: SupabaseClient, portLocode?: string | null): Promise<PdaAgency[]> {
  const { data, error } = await supabase.rpc("list_pda_port_agents", { p_port_locode: portLocode ?? null });
  if (error) throw new Error(error.message);
  return parsePdaAgencies(data);
}

/** The owner's console read of the whole registry. SERVICE ROLE client only, with an owner-tier admin actor. */
export async function pdaAdminListAgencies(admin: SupabaseClient, actorId: string): Promise<PdaAdminAgency[]> {
  const { data, error } = await admin.rpc("pda_admin_list_agencies", { p_actor: actorId });
  if (error) throw new Error(error.message);
  return parsePdaAdminAgencies(data);
}

/** Service read (owner-tier actor): open requests awaiting an agency that has no portal account (Agents phase 4). */
export async function pdaAdminListQuoteRequests(admin: SupabaseClient, actorId: string): Promise<PdaDeskQuoteRequest[]> {
  const { data, error } = await admin.rpc("pda_admin_list_quote_requests", { p_actor: actorId });
  if (error) throw new Error(error.message);
  return parsePdaDeskQuoteRequests(data);
}

/** Service command (owner-tier actor): record an agency's emailed quote on its behalf, with its source. */
export async function pdaAdminRecordAgencyQuote(admin: SupabaseClient, input: {
  actorId: string; requestId: string; agencyId: string; currency: string; lines: { label: string; serviceCode: string | null; amount: string }[];
  validUntil: string; source: string; reference: string | null; note: string | null;
}): Promise<{ quoteId: string; revision: number }> {
  const { data, error } = await admin.rpc("pda_admin_record_agency_quote", {
    p_actor: input.actorId, p_request_id: input.requestId, p_agency_org_id: input.agencyId, p_currency: input.currency,
    p_lines: input.lines, p_valid_until: input.validUntil, p_source: input.source, p_reference: input.reference, p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { quoteId?: string; revision?: number };
  return { quoteId: String(r.quoteId ?? ""), revision: Number(r.revision ?? 1) };
}

// ── Agents phase 2: quote requests (20261019100000) — every call runs in the caller's own session ──

export async function createPdaQuoteRequest(supabase: SupabaseClient, input: {
  setId: string; leg: "load" | "discharge"; agencyIds: string[]; services: string[]; note: string | null; revealIdentity: boolean;
}): Promise<{ requestId: string; agencies: number }> {
  const { data, error } = await supabase.rpc("create_pda_quote_request", {
    p_set_id: input.setId, p_leg: input.leg, p_agency_ids: input.agencyIds, p_services: input.services,
    p_note: input.note, p_reveal_identity: input.revealIdentity,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { requestId?: string; agencies?: number };
  return { requestId: String(r.requestId ?? ""), agencies: Number(r.agencies ?? 0) };
}

export async function withdrawPdaQuoteRequest(supabase: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await supabase.rpc("withdraw_pda_quote_request", { p_request_id: requestId });
  if (error) throw new Error(error.message);
}

export async function listMyPdaQuoteRequests(supabase: SupabaseClient, setId?: string | null): Promise<PdaQuoteRequest[]> {
  const { data, error } = await supabase.rpc("list_my_pda_quote_requests", { p_set_id: setId ?? null });
  if (error) throw new Error(error.message);
  return parsePdaQuoteRequests(data);
}

export async function listAgencyPdaQuoteRequests(supabase: SupabaseClient): Promise<PdaAgencyInboxItem[]> {
  const { data, error } = await supabase.rpc("list_agency_pda_quote_requests");
  if (error) throw new Error(error.message);
  return parsePdaAgencyInbox(data);
}

export async function submitPdaAgencyQuote(supabase: SupabaseClient, input: {
  requestId: string; agencyId: string; currency: string; lines: { label: string; serviceCode: string | null; amount: string }[];
  validUntil: string; reference: string | null; note: string | null;
}): Promise<{ quoteId: string; revision: number }> {
  const { data, error } = await supabase.rpc("submit_pda_agency_quote", {
    p_request_id: input.requestId, p_agency_org_id: input.agencyId, p_currency: input.currency,
    p_lines: input.lines, p_valid_until: input.validUntil, p_reference: input.reference, p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { quoteId?: string; revision?: number };
  return { quoteId: String(r.quoteId ?? ""), revision: Number(r.revision ?? 1) };
}

export async function declinePdaQuoteRequest(supabase: SupabaseClient, requestId: string, agencyId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("decline_pda_quote_request", { p_request_id: requestId, p_agency_org_id: agencyId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/** Service read: the quote and the saved route input an acceptance is rebuilt from (the requester only). */
export async function getPdaQuoteAcceptanceContext(admin: SupabaseClient, actorId: string, quoteId: string): Promise<PdaQuoteAcceptanceContext> {
  const { data, error } = await admin.rpc("pda_quote_acceptance_context", { p_actor: actorId, p_quote_id: quoteId });
  if (error) throw new Error(error.message);
  return parsePdaQuoteAcceptanceContext(data);
}

/** Service command: save the new version with the quoted port priced from the quote, and record the acceptance. */
export async function acceptPdaAgencyQuote(
  admin: SupabaseClient,
  input: {
    actorId: string;
    ownerOrgId: string | null;
    quoteId: string;
    loadRequest: PdaRequest;
    loadResult: PdaCalculationResult;
    dischargeRequest: PdaRequest;
    dischargeResult: PdaCalculationResult;
    route: PdaRouteSnapshot;
  },
): Promise<PdaSaveSetResult> {
  const { data, error } = await admin.rpc("pda_accept_agency_quote", {
    p_actor: input.actorId,
    p_owner_org_id: input.ownerOrgId,
    p_quote_id: input.quoteId,
    p_load_request: input.loadRequest,
    p_load_result: input.loadResult,
    p_discharge_request: input.dischargeRequest,
    p_discharge_result: input.dischargeResult,
    p_route: input.route,
  });
  if (error) throw new Error(error.message);
  return parsePdaSaveSetResult(data);
}
