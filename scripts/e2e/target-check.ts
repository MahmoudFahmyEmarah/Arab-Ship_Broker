// E2E target binding (C2O-078 P0): one target for seeding and teardown; every mismatch is refused before any write.
// Pure: no network, no database. Run: npx tsx scripts/e2e/target-check.ts
import assert from "node:assert/strict";
import { isHostedTarget, resolveTarget } from "../../e2e/e2e-db";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; console.log(`  ok   ${m}`); };
const refused = (env: Record<string, string | undefined>, re: RegExp, m: string) => {
  let msg = "";
  try { resolveTarget(env); } catch (e) { msg = (e as Error).message; }
  ok(re.test(msg), `${m} (${msg || "accepted!"})`);
};
const REF = "sidcsytgqalqacsgyguz";
const jwt = (p: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(p)).toString("base64url")}.y`;
const hosted = { E2E_SUPABASE_URL: `https://${REF}.supabase.co`, E2E_ALLOW_REMOTE: REF, E2E_DB_URL: `postgresql://postgres.${REF}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` };

ok(resolveTarget({}).kind === "local", "no environment = the local stack");
ok(resolveTarget({ E2E_SUPABASE_URL: "http://localhost:54321" }).kind === "local", "exact localhost is local");
refused({ E2E_SUPABASE_URL: "http://localhost.example:54321" }, /only https:\/\/<ref>\.supabase\.co/, "localhost.example is remote and refused");
refused({ E2E_SUPABASE_URL: "http://127.0.0.1.nip.io:54321" }, /only https/, "a host that merely starts with 127.0.0.1 is refused");
refused({ E2E_DB_URL: hosted.E2E_DB_URL }, /local API with a hosted database URL/, "a local API with a hosted database URL is refused");
const t = resolveTarget(hosted);
ok(t.kind === "hosted" && t.ref === REF && t.dbUrl === hosted.E2E_DB_URL, "a staging API with its own pooler URL and allowlist binds one hosted target");
ok(resolveTarget({ ...hosted, E2E_DB_URL: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres` }).kind === "hosted", "the direct db.<ref>.supabase.co host is accepted");
refused({ ...hosted, E2E_DB_URL: undefined }, /needs its matching database URL/, "a hosted API without its database URL is refused");
refused({ ...hosted, E2E_DB_URL: "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" }, /does not belong to the API's project/, "a database URL of another project is refused");
refused({ ...hosted, E2E_DB_URL: `postgresql://postgres.${REF}:pw@evil.example.com:5432/postgres` }, /does not belong/, "the right user on a foreign host is refused");
refused({ ...hosted, E2E_ALLOW_REMOTE: undefined }, /E2E_ALLOW_REMOTE must name exactly/, "a hosted API without the allowlist is refused");
refused({ ...hosted, E2E_ALLOW_REMOTE: `${REF}x` }, /E2E_ALLOW_REMOTE must name exactly/, "an allowlist that only contains the ref is refused");
refused({ ...hosted, E2E_SUPABASE_URL: `https://api.${REF}.example.com` }, /only https/, "a custom API host is refused");
refused({ ...hosted, E2E_SUPABASE_URL: `http://${REF}.supabase.co` }, /only https/, "plain http to a hosted API is refused");
refused({ ...hosted, E2E_SUPABASE_URL: "https://rezfejaxbmdzkslrrefr.supabase.co", E2E_ALLOW_REMOTE: "rezfejaxbmdzkslrrefr" }, /production project/, "the production API is refused");
refused({ ...hosted, E2E_DB_URL: "postgresql://postgres.rezfejaxbmdzkslrrefr:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" }, /production project/, "a production database URL is refused even with a staging API");
refused({ ...hosted, E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: "abcdefghijklmnopqrst", role: "service_role" }) }, /not issued for this project/, "a service key issued for another project is refused");
refused({ ...hosted, E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: "anon" }) }, /as service_role/, "an anon key passed as the service key is refused");
ok(resolveTarget({ ...hosted, E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: "service_role" }) }).kind === "hosted", "a service key issued for this project is accepted");
ok(isHostedTarget({ E2E_SUPABASE_URL: "http://localhost.example" }) && !isHostedTarget({}), "an unresolvable environment counts as hosted (random password, strict teardown)");
console.log(`E2E TARGET CHECK: ${n} passed`);
