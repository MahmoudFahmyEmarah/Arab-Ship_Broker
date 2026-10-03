"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { SupplierQuoteInput } from "@/lib/bunker/supplier";

// Supplier portal commands. They run as the signed-in member (cookie client);
// the database resolves the actor from the session and checks the supplier
// membership, editor role, registered ports and validity. Nothing here
// trusts a user id from the browser.

type Result = { ok: true; submitted: number; autoApproved: boolean } | { ok: false; error: string };

const clean = (m: string) => m.replace(/^(item \d+: )?BUNKER_[A-Z]+: /, "$1");

export async function publishQuotes(supplierId: string, quotes: SupplierQuoteInput[]): Promise<Result> {
  if (!quotes.length) return { ok: false, error: "Enter at least one price." };
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("supplier_upsert_quotes", {
    p_quotes: quotes,
    p_supplier_id: supplierId,
  });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath("/dashboard/bunker-supplier");
  const r = data as { autoApproved: boolean; results: unknown[] };
  return { ok: true, submitted: r.results.length, autoApproved: r.autoApproved };
}

export async function withdrawQuote(quoteId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("supplier_withdraw_quote", { p_quote_id: quoteId, p_reason: null });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath("/dashboard/bunker-supplier");
  return { ok: true };
}
