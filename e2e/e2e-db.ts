/**
 * E2E · one bound target for every seed, sign-in and teardown (C2O-078 P0).
 *
 * The Supabase API that seeds rows and the database that removes them must be the SAME project. resolveTarget()
 * decides that once, from the environment, before any write:
 * - local  = the API host is exactly 127.0.0.1 or localhost; no hosted database URL may be set;
 * - hosted = the API host is exactly <ref>.supabase.co, E2E_ALLOW_REMOTE names that same ref, E2E_DB_URL is set and
 *            its user/host carry that same ref (pooler user postgres.<ref>, or db.<ref>.supabase.co), and a JWT service
 *            key, when given, was issued for that ref as service_role.
 * Anything else — a custom host, `localhost.example`, a missing or mismatched database URL, the production ref
 * anywhere — is refused. The SQL transport runs psql in a container; a hosted URL travels in its environment only.
 */
import { execSync } from "node:child_process";

export const PRODUCTION_REF = "rezfejaxbmdzkslrrefr";
const REF_RE = /^[a-z0-9]{20}$/;

export interface E2ETarget {
  kind: "local" | "hosted";
  apiUrl: string;
  /** the project ref (hosted only) */
  ref: string | null;
  /** the database URL (hosted only); never printed */
  dbUrl: string | null;
}

export class E2ETargetError extends Error {
  constructor(msg: string) { super(`E2E_TARGET: ${msg}`); this.name = "E2ETargetError"; }
}

function jwtPayload(key: string): Record<string, unknown> | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>; } catch { return null; }
}

export type E2EEnv = Record<string, string | undefined>;
export function resolveTarget(env: E2EEnv = process.env): E2ETarget {
  const apiUrl = env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  if (apiUrl.includes(PRODUCTION_REF) || (env.E2E_DB_URL ?? "").includes(PRODUCTION_REF) || (env.E2E_ALLOW_REMOTE ?? "").includes(PRODUCTION_REF)) {
    throw new E2ETargetError("the production project is never an e2e target");
  }
  let api: URL;
  try { api = new URL(apiUrl); } catch { throw new E2ETargetError("E2E_SUPABASE_URL is not a URL"); }
  if (api.hostname === "127.0.0.1" || api.hostname === "localhost") {
    if (env.E2E_DB_URL) throw new E2ETargetError("a local API with a hosted database URL (E2E_DB_URL) — seeds and teardown would hit different databases");
    return { kind: "local", apiUrl, ref: null, dbUrl: null };
  }
  const m = api.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (!m || api.protocol !== "https:") throw new E2ETargetError(`only https://<ref>.supabase.co or the local stack may be seeded, not ${api.hostname}`);
  const ref = m[1];
  if (env.E2E_ALLOW_REMOTE !== ref) throw new E2ETargetError("E2E_ALLOW_REMOTE must name exactly the API's project ref");
  const dbUrl = env.E2E_DB_URL;
  if (!dbUrl) throw new E2ETargetError("a hosted API needs its matching database URL (E2E_DB_URL)");
  let db: URL;
  try { db = new URL(dbUrl); } catch { throw new E2ETargetError("E2E_DB_URL is not a URL"); }
  if (db.protocol !== "postgres:" && db.protocol !== "postgresql:") throw new E2ETargetError("E2E_DB_URL must be a postgres URL");
  const user = decodeURIComponent(db.username);
  const pooler = /\.pooler\.supabase\.com$/.test(db.hostname) && user === `postgres.${ref}`;
  const direct = db.hostname === `db.${ref}.supabase.co` && user === "postgres";
  if (!pooler && !direct) throw new E2ETargetError("E2E_DB_URL does not belong to the API's project (user/host must carry the same ref)");
  const key = env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (key) {
    const p = jwtPayload(key);
    if (p && (p.ref !== ref || p.role !== "service_role")) throw new E2ETargetError("the service key was not issued for this project as service_role");
  }
  if (!REF_RE.test(ref)) throw new E2ETargetError("malformed project ref");
  return { kind: "hosted", apiUrl, ref, dbUrl };
}

/** Supabase service paths a browser may call: Auth, REST, Storage, Edge Functions, GraphQL and Realtime. */
const SUPABASE_PATH = /^\/(auth|rest|storage|functions|graphql|realtime)\/v1(\/|$)/;

/**
 * True when a browser request goes to a Supabase service path on ANY origin other than the bound target's API
 * origin (C2O-084 P0): the app under test may have been built against another project. ws/wss are compared as
 * http/https.
 */
export function isForeignSupabaseRequest(rawUrl: string, apiUrl: string): boolean {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return false; }
  if (!SUPABASE_PATH.test(u.pathname)) return false;
  const proto = u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : u.protocol;
  return `${proto}//${u.host}` !== new URL(apiUrl).origin;
}

/** hosted unless the target resolves as local; an unresolvable environment counts as hosted (fail closed) */
export function isHostedTarget(env: E2EEnv = process.env): boolean {
  try { return resolveTarget(env).kind === "hosted"; } catch { return true; }
}

function psqlCommand(t: E2ETarget, flags: string): string {
  if (t.kind === "local") return `docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -X ${flags}`;
  // the container's sh expands $E2E_PGURL; the host shell must not (cmd.exe ignores single quotes, and $ is not special there)
  const inner = process.platform === "win32" ? `"exec psql \\"$E2E_PGURL\\" -X ${flags}"` : `'exec psql "$E2E_PGURL" -X ${flags}'`;
  return `docker run --rm -i -e E2E_PGURL --entrypoint sh ${process.env.E2E_PG_IMAGE ?? "public.ecr.aws/supabase/postgres:17.6.1.127"} -c ${inner}`;
}
const psqlEnv = (t: E2ETarget) => ({ ...process.env, MSYS_NO_PATHCONV: "1", E2E_PGURL: t.dbUrl ?? "" });
const redact = (s: string) => s.replace(/postgres(ql)?:\/\/\S+/g, "<db-url>").trim().slice(0, 800);
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Legacy batch runner (ON_ERROR_STOP=0): kept for specs that own their SQL. Same bound target and transport. */
export function dbExec(sql: string): void {
  const t = resolveTarget();
  const cmd = psqlCommand(t, "-q -v ON_ERROR_STOP=0");
  for (let attempt = 1; ; attempt++) {
    try {
      execSync(cmd, { input: sql, stdio: ["pipe", "ignore", "ignore"], env: psqlEnv(t) });
      return;
    } catch (e) {
      if (attempt >= 4) throw e;
      pause(5000 * attempt);
    }
  }
}

/**
 * Runs a batch as ONE transaction with ON_ERROR_STOP (psql -1): every statement commits, or none does. `sql` may be a
 * function of the attempt number, so a retry after a lost connection can accept the proved replay state (all rows
 * already gone) that a first attempt must not. Only a connection failure (exit 2) is retried.
 */
export function dbTx(label: string, sql: string | ((attempt: number) => string)): void {
  const t = resolveTarget();
  const cmd = psqlCommand(t, "-q -1 -v ON_ERROR_STOP=1");
  for (let attempt = 1; ; attempt++) {
    try {
      execSync(cmd, { input: typeof sql === "string" ? sql : sql(attempt), stdio: ["pipe", "ignore", "pipe"], env: psqlEnv(t) });
      return;
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer | string };
      if (err.status === 2 && attempt < 4) { pause(5000 * attempt); continue; }
      throw new Error(`${label}: rolled back (psql exit ${err.status ?? "?"}) — ${redact(String(err.stderr ?? "")) || "no message"}`);
    }
  }
}

/** A read on the bound target: rows as tab-separated lines (psql -At). */
export function dbQuery(sql: string): string[] {
  const t = resolveTarget();
  try {
    const out = execSync(psqlCommand(t, "-q -At -v ON_ERROR_STOP=1"), { input: sql, stdio: ["pipe", "pipe", "pipe"], env: psqlEnv(t), encoding: "utf8" });
    return out.split(/\r?\n/).filter((l) => l.length > 0);
  } catch (e) {
    throw new Error(`e2e query failed — ${redact(String((e as { stderr?: string }).stderr ?? ""))}`);
  }
}
