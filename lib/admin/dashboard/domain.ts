// Domain & mail snapshot for the console dashboard — registry data (RDAP),
// the DNS records that decide email deliverability (SPF / DKIM / DMARC / MX),
// a TCP reachability probe of the SMTP host, and, when the Namecheap API is
// configured, the account-side facts (auto-renew, lock, WhoisGuard).
// Public sources need no credentials. Results are cached in-process for ten
// minutes so a busy admin does not hammer the registry. Never throws.
import { promises as dns } from "node:dns";
import net from "node:net";
import type { DomainSnapshot } from "./types";

const TTL_MS = 10 * 60_000;
let cache: { key: string; at: number; value: DomainSnapshot } | null = null;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function rdap(domain: string, errors: string[]) {
  const tld = domain.split(".").pop() ?? "com";
  const urls = tld === "com" || tld === "net"
    ? [`https://rdap.verisign.com/${tld}/v1/domain/${domain}`, `https://rdap.org/domain/${domain}`]
    : [`https://rdap.org/domain/${domain}`];
  for (const url of urls) {
    try {
      const res = await withTimeout(fetch(url, {
        headers: { accept: "application/rdap+json", "user-agent": "arabshipbroker-admin/1.0" },
        cache: "no-store",
      }), 5000, "RDAP");
      if (!res.ok) continue;
      const j = (await res.json()) as {
        events?: { eventAction: string; eventDate: string }[];
        status?: string[];
        nameservers?: { ldhName?: string }[];
        entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]]; handle?: string }[];
        secureDNS?: { delegationSigned?: boolean };
      };
      const ev = (name: string) => j.events?.find((e) => e.eventAction === name)?.eventDate ?? null;
      const reg = j.entities?.find((e) => e.roles?.includes("registrar"));
      const fn = reg?.vcardArray?.[1]?.find((x) => x[0] === "fn")?.[3];
      return {
        registrar: typeof fn === "string" ? fn : reg?.handle ?? null,
        registered_at: ev("registration"),
        expires_at: ev("expiration"),
        changed_at: ev("last changed"),
        statuses: j.status ?? [],
        nameservers: (j.nameservers ?? []).map((n) => (n.ldhName ?? "").toLowerCase()).filter(Boolean),
        dnssec: j.secureDNS?.delegationSigned ?? null,
      };
    } catch (e) {
      errors.push(`RDAP: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return null;
}

async function txt(name: string): Promise<string[]> {
  try { return (await withTimeout(dns.resolveTxt(name), 4000, "DNS")).map((r) => r.join("")); }
  catch { return []; }
}

async function probeTcp(host: string, port: number): Promise<{ reachable: boolean; ms: number | null; error: string | null }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 4000 }, () => { s.destroy(); resolve({ reachable: true, ms: Date.now() - t0, error: null }); });
    s.on("error", (e) => { s.destroy(); resolve({ reachable: false, ms: null, error: e.message }); });
    s.on("timeout", () => { s.destroy(); resolve({ reachable: false, ms: null, error: "timeout" }); });
  });
}

/** namecheap.domains.getList for one domain — only when the API is configured. */
async function namecheap(domain: string, errors: string[]): Promise<DomainSnapshot["namecheap"]> {
  const user = process.env.NAMECHEAP_API_USER, key = process.env.NAMECHEAP_API_KEY, ip = process.env.NAMECHEAP_CLIENT_IP;
  if (!user || !key || !ip) return { connected: false, auto_renew: null, locked: null, whois_guard: null, expired: null };
  try {
    const q = new URLSearchParams({
      ApiUser: user, ApiKey: key, UserName: process.env.NAMECHEAP_USERNAME ?? user, ClientIp: ip,
      Command: "namecheap.domains.getList", SearchTerm: domain, PageSize: "20",
    });
    const res = await withTimeout(fetch(`https://api.namecheap.com/xml.response?${q}`, { cache: "no-store" }), 6000, "Namecheap");
    const xml = await res.text();
    const row = xml.split("<Domain ").find((s) => s.includes(`Name="${domain}"`));
    if (!row) { errors.push("Namecheap: domain not in this account"); return { connected: true, auto_renew: null, locked: null, whois_guard: null, expired: null }; }
    const attr = (n: string) => new RegExp(`${n}="([^"]*)"`).exec(row)?.[1] ?? null;
    return {
      connected: true,
      auto_renew: attr("AutoRenew") === "true",
      locked: attr("IsLocked") === "true",
      whois_guard: attr("WhoisGuard") === "ENABLED",
      expired: attr("IsExpired") === "true",
    };
  } catch (e) {
    errors.push(`Namecheap: ${e instanceof Error ? e.message : String(e)}`);
    return { connected: true, auto_renew: null, locked: null, whois_guard: null, expired: null };
  }
}

export async function fetchDomainSnapshot(opts: { domain: string; smtpHost: string | null; smtpPort: number; mailbox: string | null; cpanelHost: string | null; dkimSelector?: string }): Promise<DomainSnapshot> {
  const key = JSON.stringify(opts);
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;

  const errors: string[] = [];
  const selector = opts.dkimSelector ?? "default";
  const [reg, rootTxt, dmarcTxt, dkimTxt, mx, ns, smtp, nc] = await Promise.all([
    rdap(opts.domain, errors),
    txt(opts.domain),
    txt(`_dmarc.${opts.domain}`),
    txt(`${selector}._domainkey.${opts.domain}`),
    dns.resolveMx(opts.domain).catch(() => [] as { exchange: string; priority: number }[]),
    dns.resolveNs(opts.domain).catch(() => [] as string[]),
    opts.smtpHost ? probeTcp(opts.smtpHost, opts.smtpPort) : Promise.resolve(null),
    namecheap(opts.domain, errors),
  ]);

  const spf = rootTxt.find((t) => /^v=spf1/i.test(t)) ?? null;
  const dmarc = dmarcTxt.find((t) => /^v=DMARC1/i.test(t)) ?? null;
  const dkim = dkimTxt.find((t) => /v=DKIM1/i.test(t) || /p=/.test(t)) ?? null;
  const policy = dmarc ? (/p=([a-z]+)/i.exec(dmarc)?.[1]?.toLowerCase() ?? null) : null;
  const expires = reg?.expires_at ?? null;
  const daysLeft = expires ? Math.floor((new Date(expires).getTime() - Date.now()) / 86_400_000) : null;

  const value: DomainSnapshot = {
    domain: opts.domain,
    checked_at: new Date().toISOString(),
    registrar: reg?.registrar ?? null,
    registered_at: reg?.registered_at ?? null,
    expires_at: expires,
    changed_at: reg?.changed_at ?? null,
    days_left: daysLeft,
    statuses: reg?.statuses ?? [],
    nameservers: reg?.nameservers?.length ? reg.nameservers : ns.map((n) => n.toLowerCase()),
    dnssec: reg?.dnssec ?? null,
    mx: mx.sort((a, b) => a.priority - b.priority).map((m) => ({ host: m.exchange, priority: m.priority })),
    spf: { present: !!spf, record: spf, all: spf ? (/([-~?+])all/i.exec(spf)?.[1] ?? null) : null },
    dkim: { present: !!dkim, selector },
    dmarc: { present: !!dmarc, policy, record: dmarc, has_report: dmarc ? /rua=/i.test(dmarc) : false },
    smtp: { host: opts.smtpHost, port: opts.smtpPort, reachable: smtp?.reachable ?? null, ms: smtp?.ms ?? null, error: smtp?.error ?? null },
    mailbox: opts.mailbox,
    cpanel_host: opts.cpanelHost,
    namecheap: nc,
    errors,
  };
  cache = { key, at: Date.now(), value };
  return value;
}
