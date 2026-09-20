// UN/LOCODE registry refresh — owner/IT only. Accepts a multipart upload of the
// UNECE CSV (or a headed CSV export) or a JSON body { url, release, all }.
// Default imports only the countries present in our ports table; `all` imports
// every country (≈110k rows). Recomputes nothing else: the drift report is a
// live view over ports vs unlocode_registry.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { dqDb } from "@/lib/dq/engine";
import { parseRegistryCsv, tradingCountries, upsertRegistry } from "@/lib/dq/registry";
import { REGISTRY_LIMITS, contentTypeAllowed, readCapped, redirectAllowed, registryUrlProblem } from "@/lib/dq/registry-policy";

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
      if (file.size > REGISTRY_LIMITS.bytes) return NextResponse.json({ ok: false, error: `The file is larger than ${Math.round(REGISTRY_LIMITS.bytes / 1024 / 1024)} MB.` }, { status: 413 });
      text = await file.text(); release = String(fd.get("release") ?? "").trim(); all = fd.get("all") === "true";
    } else {
      // Workstream A (19 Sep 2026): UNECE hosts only, redirects only within
      // them, a deadline, a CSV body, and a byte ceiling read as a stream.
      const body = (await req.json()) as { url?: string; release?: string; all?: boolean };
      const problem = registryUrlProblem(body.url ?? "");
      if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), REGISTRY_LIMITS.timeoutMs);
      try {
        let url = new URL(body.url as string);
        let res: Response | null = null;
        for (let hop = 0; hop <= REGISTRY_LIMITS.redirects; hop += 1) {
          res = await fetch(url, { cache: "no-store", redirect: "manual", signal: ctl.signal });
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location");
            if (!loc || !redirectAllowed(loc, url)) return NextResponse.json({ ok: false, error: "The download redirected outside the UN/LOCODE hosts; import the file by upload instead." }, { status: 400 });
            url = new URL(loc, url);
            continue;
          }
          break;
        }
        if (!res || !res.ok) return NextResponse.json({ ok: false, error: `Download failed: HTTP ${res?.status ?? "no response"}` }, { status: 400 });
        if (!contentTypeAllowed(res.headers.get("content-type"))) return NextResponse.json({ ok: false, error: `Expected a CSV, got ${res.headers.get("content-type")}. The UNECE zip must be unpacked and uploaded as the CSV.` }, { status: 400 });
        text = await readCapped(res.body, REGISTRY_LIMITS.bytes);
      } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        return NextResponse.json({ ok: false, error: aborted ? `The download took longer than ${REGISTRY_LIMITS.timeoutMs / 1000} s.` : (e instanceof Error ? e.message : "Download failed.") }, { status: aborted ? 504 : 400 });
      } finally {
        clearTimeout(timer);
      }
      release = (body.release ?? "").trim(); all = !!body.all;
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
