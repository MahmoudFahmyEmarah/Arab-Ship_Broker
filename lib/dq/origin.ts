// Where the Data Quality engine re-kicks itself (workstream A, 19 Sep 2026).
//
// The engine route, the nightly cron and the console used to derive the
// callback origin from `x-forwarded-host` and then POST the cron secret to
// it. A request header is attacker-controlled: one forged header and the
// secret leaves the platform. The origin now comes from configuration only.
//
//   DQ_ENGINE_URL                   the canonical https origin (set this)
//   VERCEL_PROJECT_PRODUCTION_URL   Vercel's own system value, used when the
//                                   first is unset — infrastructure-provided,
//                                   never request-derived
//   development                     http://localhost:3000
//
// Production with neither value is a configuration error and the caller
// refuses to run rather than guessing.

export class EngineOriginError extends Error {}

/** Validate one candidate: exactly one origin, https in production, no path, query or credentials. */
export function normaliseOrigin(raw: string, { allowHttp = false }: { allowHttp?: boolean } = {}): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new EngineOriginError(`DQ_ENGINE_URL is not a URL: "${raw}"`); }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) throw new EngineOriginError(`DQ_ENGINE_URL must be an https origin, got "${raw}"`);
  if (u.username || u.password) throw new EngineOriginError("DQ_ENGINE_URL must not carry credentials");
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) throw new EngineOriginError(`DQ_ENGINE_URL must be a bare origin without a path, got "${raw}"`);
  return u.origin;
}

export function engineOrigin(env: Record<string, string | undefined> = process.env): string {
  const production = env.NODE_ENV === "production";
  const explicit = env.DQ_ENGINE_URL?.trim();
  if (explicit) return normaliseOrigin(explicit, { allowHttp: !production });
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return normaliseOrigin(vercel.startsWith("http") ? vercel : `https://${vercel}`);
  if (!production) return "http://localhost:3000";
  throw new EngineOriginError("DQ_ENGINE_URL is not set — the engine cannot re-kick itself. Set it to the site's canonical https origin (https://www.arabshipbroker.com).");
}

/** True when a would-be callback target is the configured origin and nothing else. */
export function isEngineOrigin(candidate: string, env: Record<string, string | undefined> = process.env): boolean {
  try { return new URL(candidate).origin === engineOrigin(env); } catch { return false; }
}
