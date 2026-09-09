// UN/LOCODE registry refresh — owner/IT only. Accepts a multipart upload of the
// UNECE CSV (or a headed CSV export) or a JSON body { url, release, all }.
// Default imports only the countries present in our ports table; `all` imports
// every country (≈110k rows). Recomputes nothing else: the drift report is a
// live view over ports vs unlocode_registry.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { dqDb } from "@/lib/dq/engine";
import { parseRegistryCsv, tradingCountries, upsertRegistry } from "@/lib/dq/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const admin = await requireAdmin({ section: "dataquality", edit: true });
  const sb = dqDb();
  try {
    let text = ""; let release = ""; let all = false;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No file uploaded." }, { status: 400 });
      text = await file.text(); release = String(fd.get("release") ?? "").trim(); all = fd.get("all") === "true";
    } else {
      const body = (await req.json()) as { url?: string; release?: string; all?: boolean };
      if (!body.url || !/^https:\/\//.test(body.url)) return NextResponse.json({ ok: false, error: "A https URL to a CSV export is required." }, { status: 400 });
      const res = await fetch(body.url, { cache: "no-store" });
      if (!res.ok) return NextResponse.json({ ok: false, error: `Download failed: HTTP ${res.status}` }, { status: 400 });
      text = await res.text(); release = (body.release ?? "").trim(); all = !!body.all;
    }
    if (!release) release = new Date().toISOString().slice(0, 7);
    const countries = all ? undefined : await tradingCountries(sb);
    const rows = parseRegistryCsv(text, release, countries);
    if (!rows.length) return NextResponse.json({ ok: false, error: "No UN/LOCODE rows recognised in the file (expected the UNECE code-list CSV layout)." }, { status: 400 });
    const n = await upsertRegistry(sb, rows);
    await sb.from("dq_settings").update({ registry_release: release, registry_imported_at: new Date().toISOString(), updated_by: admin.supabaseUserId }).eq("id", 1);
    return NextResponse.json({ ok: true, rows: n, release, countries: countries ? countries.size : "all" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Import failed." }, { status: 500 });
  }
}
