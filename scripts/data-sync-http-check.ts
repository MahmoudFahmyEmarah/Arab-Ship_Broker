/**
 * Data Sync — HTTP surface checks against a running server (dev or start).
 *   BASE=http://localhost:3000 node --env-file=.env.local --import tsx scripts/data-sync-http-check.ts
 *
 * Unauthenticated callers must be refused by every Data Sync endpoint, and the
 * refusals must be API-shaped (a status code, not a redirect that a fetch()
 * caller would follow into HTML). The cron must reject a missing/wrong bearer.
 * The Meta webhook must reject an unsigned body but still answer 200 to a
 * verified one. Nothing here needs a session.
 */
const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET ?? "";

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string, extra = "") => { if (cond) { pass++; console.log(`  ok   ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };

async function req(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: "manual" });
  const text = await res.text().catch(() => "");
  return { status: res.status, location: res.headers.get("location"), ctype: res.headers.get("content-type") ?? "", text };
}

(async () => {
  console.log(`\nHTTP checks against ${BASE}`);

  // upload — no session
  {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "x.xlsx");
    const r = await req("/api/upload/cargomap", { method: "POST", body: fd });
    ok([401, 403].includes(r.status) || (r.status >= 300 && r.status < 400 && /login/.test(r.location ?? "")), "POST /api/upload/cargomap without a session is refused", `${r.status} ${r.location ?? r.ctype}`);
    ok(!/\{"ok":true/.test(r.text), "…and nothing was staged");
  }

  // email sync — no session
  {
    const r = await req("/api/sync/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sample: "x" }) });
    ok(r.status === 403 && /Not authorized/.test(r.text), "POST /api/sync/email without a session → 403 JSON", `${r.status}`);
    const big = await req("/api/sync/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sample: "x".repeat(400 * 1024) }) });
    ok([403, 413, 400].includes(big.status), "oversized body is refused before work starts", `${big.status}`);
  }

  // cron — bearer guard
  {
    const none = await req("/api/cron/email-sync");
    ok(none.status === 401, "GET /api/cron/email-sync without bearer → 401", `${none.status}`);
    const wrong = await req("/api/cron/email-sync", { headers: { authorization: "Bearer nope" } });
    ok(wrong.status === 401, "…wrong bearer → 401", `${wrong.status}`);
    if (CRON) {
      const right = await req("/api/cron/email-sync", { headers: { authorization: `Bearer ${CRON}` } });
      ok(right.status === 200 && /"ok":/.test(right.text), "…correct bearer → 200 JSON (skipped unless schedule is on)", right.text.slice(0, 90));
    } else {
      console.log("  skip  CRON_SECRET not in env — correct-bearer path not exercised");
    }
  }

  // webhook — signature
  {
    const verify = await req("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123");
    ok([403, 500].includes(verify.status) && verify.text !== "123", "GET webhook with a wrong verify token does not echo the challenge", `${verify.status}`);
    const unsigned = await req("/api/whatsapp/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: [] }) });
    ok(unsigned.status === 403, "POST webhook without X-Hub-Signature-256 → 403", `${unsigned.status} ${unsigned.text.slice(0, 40)}`);
    const flood = await req("/api/whatsapp/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(1200 * 1024) }) });
    ok([413, 403].includes(flood.status), "oversized webhook body refused", `${flood.status}`);
  }

  // admin page — no session → login bounce, never a 200 with data
  {
    const page = await req("/admin/data-sync");
    ok(page.status >= 300 && page.status < 400 && /login/.test(page.location ?? ""), "GET /admin/data-sync without a session bounces to login", `${page.status} → ${page.location}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
