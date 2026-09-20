// Import policy for the UN/LOCODE registry (workstream A, 19 Sep 2026).
//
// The registry route used to fetch any https URL an admin typed, follow every
// redirect, and read the whole body into memory. Now: only the UNECE hosts
// (or the hosts named in DQ_REGISTRY_HOSTS), redirects only within the
// allowlist, a CSV or plain-text body, a 30 s deadline and a 50 MB ceiling.

export const REGISTRY_LIMITS = { bytes: 50 * 1024 * 1024, timeoutMs: 30_000, redirects: 3 } as const;

const DEFAULT_HOSTS = ["unece.org"];

/** Host allowlist: exact host or any subdomain of it. */
export function registryHosts(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env.DQ_REGISTRY_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set([...DEFAULT_HOSTS, ...extra]));
}

export function hostAllowed(hostname: string, hosts = registryHosts()): boolean {
  const h = hostname.toLowerCase();
  return hosts.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/** Why a URL may not be fetched, or null when it may. */
export function registryUrlProblem(raw: string, hosts = registryHosts()): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "That is not a URL."; }
  if (u.protocol !== "https:") return "Only https URLs are fetched.";
  if (u.username || u.password) return "URLs with credentials are not fetched.";
  if (!hostAllowed(u.hostname, hosts)) return `Only the UN/LOCODE hosts are fetched (${hosts.join(", ")}); ${u.hostname} is not one of them.`;
  return null;
}

/** A redirect is followed only to an allowed host. */
export function redirectAllowed(location: string, from: URL, hosts = registryHosts()): boolean {
  try { const to = new URL(location, from); return to.protocol === "https:" && hostAllowed(to.hostname, hosts); } catch { return false; }
}

export function contentTypeAllowed(ct: string | null): boolean {
  const t = (ct ?? "").toLowerCase();
  return t === "" || /^(text\/csv|text\/plain|application\/csv|application\/vnd\.ms-excel)/.test(t);
}

/** Read a body up to the byte ceiling; over it, abort and say so. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, cap = REGISTRY_LIMITS.bytes): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { await reader.cancel().catch(() => undefined); throw new Error(`The file is larger than ${Math.round(cap / 1024 / 1024)} MB — import the UNECE CSV for the trading countries only.`); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return new TextDecoder("utf-8").decode(out);
}
