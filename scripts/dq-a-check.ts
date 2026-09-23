/**
 * Data Quality · workstream A checks (no network). Run:  npx tsx scripts/dq-a-check.ts
 *  - the engine callback origin comes from configuration only, never a request
 *  - the registry import fetches UNECE hosts only, follows redirects only there,
 *    accepts CSV/plain bodies, and stops reading at the byte ceiling
 * The evaluator allowlist is exercised by supabase/tests/data_quality/dq_a_boundary_smoke.sql.
 */
import { engineOrigin, isEngineOrigin, normaliseOrigin } from "@/lib/dq/origin";
import { REGISTRY_LIMITS, contentTypeAllowed, readCapped, redirectAllowed, registryHosts, registryUrlProblem } from "@/lib/dq/registry-policy";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const throws = (fn: () => unknown, re: RegExp): boolean => { try { fn(); return false; } catch (e) { return re.test(e instanceof Error ? e.message : String(e)); } };

console.log("engine origin");
ok(engineOrigin({ NODE_ENV: "production", DQ_ENGINE_URL: "https://www.arabshipbroker.com" }) === "https://www.arabshipbroker.com", "explicit https origin is used as is");
ok(engineOrigin({ NODE_ENV: "production", DQ_ENGINE_URL: "https://www.arabshipbroker.com/" }) === "https://www.arabshipbroker.com", "trailing slash is fine");
ok(throws(() => engineOrigin({ NODE_ENV: "production", DQ_ENGINE_URL: "http://www.arabshipbroker.com" }), /https/), "http is refused in production");
ok(throws(() => engineOrigin({ NODE_ENV: "production", DQ_ENGINE_URL: "https://www.arabshipbroker.com/api" }), /path/), "a path is refused");
ok(throws(() => engineOrigin({ NODE_ENV: "production", DQ_ENGINE_URL: "https://user:pw@host.example" }), /credentials/), "credentials are refused");
ok(engineOrigin({ NODE_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "arab-ship-broker.vercel.app" }) === "https://arab-ship-broker.vercel.app", "Vercel's system value is the fallback");
ok(throws(() => engineOrigin({ NODE_ENV: "production" }), /DQ_ENGINE_URL is not set/), "production with nothing configured is a hard error");
ok(engineOrigin({ NODE_ENV: "development" }) === "http://localhost:3000", "development falls back to localhost");
ok(engineOrigin({ NODE_ENV: "development", DQ_ENGINE_URL: "http://localhost:3001" }) === "http://localhost:3001", "http allowed outside production");
ok(isEngineOrigin("https://www.arabshipbroker.com/api/dq/engine", { NODE_ENV: "production", DQ_ENGINE_URL: "https://www.arabshipbroker.com" }), "the configured origin is recognised");
ok(!isEngineOrigin("https://evil.example/api/dq/engine", { NODE_ENV: "production", DQ_ENGINE_URL: "https://www.arabshipbroker.com" }), "a forged host is not");
ok(normaliseOrigin("HTTPS://WWW.ArabShipBroker.com") === "https://www.arabshipbroker.com", "origin is normalised");

console.log("registry import policy");
ok(registryHosts({}).join(",") === "unece.org", "default allowlist is unece.org");
ok(registryHosts({ DQ_REGISTRY_HOSTS: "example.org, Data.Example.com" }).includes("data.example.com"), "extra hosts come from the environment, lower-cased");
ok(registryUrlProblem("https://service.unece.org/trade/locode/loc241csv.zip") === null, "a UNECE subdomain is allowed");
ok(/not one of them/.test(registryUrlProblem("https://raw.githubusercontent.com/x/y.csv") ?? ""), "another host is refused and named");
ok(/https/.test(registryUrlProblem("http://unece.org/x.csv") ?? ""), "http is refused");
ok(/credentials/.test(registryUrlProblem("https://a:b@unece.org/x.csv") ?? ""), "credentials are refused");
ok(/not a URL/.test(registryUrlProblem("nope") ?? ""), "garbage is refused");
ok(redirectAllowed("/trade/locode/other.csv", new URL("https://service.unece.org/a")), "a same-host relative redirect is followed");
ok(!redirectAllowed("https://evil.example/x.csv", new URL("https://service.unece.org/a")), "a cross-host redirect is not");
ok(contentTypeAllowed("text/csv; charset=utf-8") && contentTypeAllowed("text/plain") && contentTypeAllowed(null), "csv, plain and missing content types pass");
ok(!contentTypeAllowed("application/zip") && !contentTypeAllowed("text/html"), "zip and html are refused");

console.log("byte ceiling");
const stream = (parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
async function main() {
  const small = await readCapped(stream(["a,b\n", "1,2\n"]), 1024);
  ok(small === "a,b\n1,2\n", "a small body is read whole");
  let err = "";
  try { await readCapped(stream(["x".repeat(600), "y".repeat(600)]), 1000); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  ok(/larger than/.test(err), "a body over the ceiling is refused mid-stream");
  ok(REGISTRY_LIMITS.bytes === 50 * 1024 * 1024 && REGISTRY_LIMITS.timeoutMs === 30_000, "limits are 50 MB and 30 s");
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();
