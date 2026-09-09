// USD→EGP reference rate for the EGP equivalent every invoice must carry.
// Preferred source: the Central Bank of Egypt's published rate page. It has no
// public JSON API, so the page is parsed; when that fails a public FX feed
// fills in and the row says so. The rate is stored per day in fx_rates and
// frozen on the invoice at issue time; the owner can always override it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { round5 } from "./money";

const CBE_URL = "https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates";
const FALLBACK_URL = "https://open.er-api.com/v6/latest/USD";

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
}

/** Parse the CBE page: find the "US Dollar" row and take the selling rate (last number). */
async function fromCbe(): Promise<number | null> {
  try {
    const res = await withTimeout(fetch(CBE_URL, { headers: { "user-agent": "arabshipbroker-billing/1.0" }, cache: "no-store" }), 8000);
    if (!res.ok) return null;
    const html = (await res.text()).replace(/\s+/g, " ");
    const idx = html.search(/US\s*Dollar/i);
    if (idx < 0) return null;
    const slice = html.slice(idx, idx + 1200);
    const nums = [...slice.matchAll(/(\d{1,3}(?:\.\d{2,4}))/g)].map((m) => Number(m[1])).filter((n) => n > 10 && n < 500);
    if (nums.length < 2) return null;
    // CBE lists buy then sell; use sell (higher) for what a customer pays
    return round5(Math.max(nums[0], nums[1]));
  } catch {
    return null;
  }
}

async function fromFallback(): Promise<number | null> {
  try {
    const res = await withTimeout(fetch(FALLBACK_URL, { cache: "no-store" }), 6000);
    if (!res.ok) return null;
    const j = (await res.json()) as { rates?: Record<string, number> };
    const r = j.rates?.EGP;
    return r && r > 0 ? round5(r) : null;
  } catch {
    return null;
  }
}

export type FxLookup = { rate: number; source: string; day: string };

/** Today's USD→EGP rate: from fx_rates if already stored, else fetched and stored. */
export async function getUsdEgpRate(sb: SupabaseClient, day = new Date().toISOString().slice(0, 10)): Promise<FxLookup | null> {
  const { data } = await sb.from("fx_rates").select("rate, source, day").eq("day", day).eq("base", "USD").eq("quote", "EGP").maybeSingle();
  if (data) return { rate: Number(data.rate), source: data.source, day: data.day };

  let rate = await fromCbe();
  let source = "CBE";
  if (rate == null) { rate = await fromFallback(); source = "open.er-api.com (fallback)"; }
  if (rate == null) {
    // last known rate, clearly labelled
    const { data: last } = await sb.from("fx_rates").select("rate, source, day").eq("base", "USD").eq("quote", "EGP").order("day", { ascending: false }).limit(1).maybeSingle();
    return last ? { rate: Number(last.rate), source: `${last.source} (last known ${last.day})`, day: last.day } : null;
  }
  await sb.from("fx_rates").upsert({ day, base: "USD", quote: "EGP", rate, source }, { onConflict: "day,base,quote" });
  return { rate, source, day };
}

export async function setManualRate(sb: SupabaseClient, rate: number, day = new Date().toISOString().slice(0, 10)): Promise<void> {
  await sb.from("fx_rates").upsert({ day, base: "USD", quote: "EGP", rate: round5(rate), source: "manual" }, { onConflict: "day,base,quote" });
}
