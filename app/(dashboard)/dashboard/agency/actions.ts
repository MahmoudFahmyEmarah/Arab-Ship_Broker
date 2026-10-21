"use server";

// The agency inbox (Agents phase 2, owner decision O2ALL-009 A1 c): staff of an ASB-invited agency answer quote
// requests. No PDA subscription is needed — who may act is decided entirely by the database (an active member of an
// active listed agency, addressed by the request). Every call runs in the signed-in user's own session.
import type { PdaAgencyInboxItem } from "@/lib/pda/quote-requests";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { declinePdaQuoteRequest, listAgencyPdaQuoteRequests, submitPdaAgencyQuote } from "@/sdk/app/pda";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function session() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("PDA_AUTH: sign in required");
  return supabase;
}

/** Database messages are written for people (PDA_VALIDATION / PDA_STATE / PDA_AUTH); anything else stays generic. */
function message(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : "";
  if (/^PDA_(VALIDATION|STATE|AUTH): /.test(text)) return text.replace(/^PDA_[A-Z]+: /, "");
  console.error(`[agency] ${fallback}`, error);
  return fallback;
}

export async function loadAgencyInbox(): Promise<ActionResult<PdaAgencyInboxItem[]>> {
  try {
    return { ok: true, data: await listAgencyPdaQuoteRequests(await session()) };
  } catch (error) {
    return { ok: false, error: message(error, "The requests could not be loaded") };
  }
}

export async function submitAgencyQuote(input: {
  requestId: string; agencyId: string; currency: string; lines: { label: string; serviceCode: string | null; amount: string }[];
  validUntil: string; reference: string; note: string;
}): Promise<ActionResult<{ quoteId: string; revision: number }>> {
  try {
    if (!UUID.test(input.requestId) || !UUID.test(input.agencyId)) throw new Error("PDA_VALIDATION: unknown request");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) throw new Error("PDA_VALIDATION: give the date the quote is valid until");
    return { ok: true, data: await submitPdaAgencyQuote(await session(), {
      requestId: input.requestId, agencyId: input.agencyId, currency: input.currency.trim().toUpperCase(), lines: input.lines,
      validUntil: input.validUntil, reference: input.reference.trim() || null, note: input.note.trim() || null,
    }) };
  } catch (error) {
    return { ok: false, error: message(error, "The quote could not be sent") };
  }
}

export async function declineAgencyRequest(requestId: string, agencyId: string, reason: string): Promise<ActionResult<null>> {
  try {
    if (!UUID.test(requestId) || !UUID.test(agencyId)) throw new Error("PDA_VALIDATION: unknown request");
    await declinePdaQuoteRequest(await session(), requestId, agencyId, reason);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: message(error, "The request could not be declined") };
  }
}
