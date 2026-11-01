// PDA · the Tariff Packs library model (design B2ALL-061, build step 6).
//
// The library reads ONE governed RPC, list_pda_tariff_packs (20261019130000): one pack per published source document,
// with every port whose tariff in force cites it. A pack is addressed by an opaque 16-hex reference, never a row id.
// These helpers are pure (parse, resolver, summary) so the page and the contract check share one definition.

export interface PdaTariffPackPort {
  locode: string;
  name: string;
  /** null = the port-wide tariff */
  terminal: string | null;
  edition: string;
  lines: number;
}

export interface PdaTariffPack {
  packRef: string;
  authority: string;
  publisherType: string | null;
  country: string | null;
  sourceTitle: string;
  /** 'official' is a primary source; anything else is secondary */
  sourceAuthority: string;
  issueDate: string | null;
  /** one ISO code, or 'mixed' when the editions differ */
  currency: string;
  effectiveFrom: string | null;
  lines: number;
  ports: PdaTariffPackPort[];
}

export interface PdaTariffResolverRow {
  locode: string;
  name: string;
  packs: Array<{ packRef: string; authority: string; terminal: string | null }>;
}

const PACK_REF = /^[0-9a-f]{16}$/;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const isPdaTariffPackRef = (ref: unknown): ref is string => typeof ref === "string" && PACK_REF.test(ref);
export const isPrimaryTariffPack = (pack: Pick<PdaTariffPack, "sourceAuthority">) => pack.sourceAuthority === "official";

/** Normalise the RPC payload; an entry without a valid reference is dropped (it could not be opened). */
export function parsePdaTariffPacks(raw: unknown): PdaTariffPack[] {
  const items = Array.isArray(raw) ? raw : [];
  return items.flatMap((item) => {
    const k = (item ?? {}) as Record<string, unknown>;
    if (!isPdaTariffPackRef(k.packRef)) return [];
    const ports = Array.isArray(k.ports) ? k.ports : [];
    return [{
      packRef: k.packRef,
      authority: str(k.authority) ?? str(k.sourceTitle) ?? "Unnamed publisher",
      publisherType: str(k.publisherType),
      country: str(k.country),
      sourceTitle: str(k.sourceTitle) ?? "",
      sourceAuthority: str(k.sourceAuthority) ?? "unverified",
      issueDate: str(k.issueDate),
      currency: str(k.currency) ?? "",
      effectiveFrom: str(k.effectiveFrom),
      lines: num(k.lines),
      ports: ports.map((entry) => {
        const p = (entry ?? {}) as Record<string, unknown>;
        return { locode: String(p.locode ?? ""), name: String(p.name ?? p.locode ?? ""), terminal: str(p.terminal), edition: String(p.edition ?? ""), lines: num(p.lines) };
      }).filter((p) => p.locode),
    }];
  });
}

/** Port → the packs that price it (the lookup a broker starts from), ordered by port name. */
export function resolvePdaTariffPorts(packs: readonly PdaTariffPack[]): PdaTariffResolverRow[] {
  const byPort = new Map<string, PdaTariffResolverRow>();
  for (const pack of packs) {
    for (const port of pack.ports) {
      const row = byPort.get(port.locode) ?? { locode: port.locode, name: port.name, packs: [] };
      if (!row.packs.some((p) => p.packRef === pack.packRef && p.terminal === port.terminal)) {
        row.packs.push({ packRef: pack.packRef, authority: pack.authority, terminal: port.terminal });
      }
      byPort.set(port.locode, row);
    }
  }
  return [...byPort.values()].sort((a, b) => a.name.localeCompare(b.name) || a.locode.localeCompare(b.locode));
}

/** How many DISTINCT packs price a port (a port-wide and a terminal edition of one pack count once). */
export const packCount = (row: PdaTariffResolverRow) => new Set(row.packs.map((p) => p.packRef)).size;

export function summarisePdaTariffPacks(packs: readonly PdaTariffPack[]) {
  const resolver = resolvePdaTariffPorts(packs);
  return { packs: packs.length, portsResolved: resolver.length, portsWithSeveral: resolver.filter((r) => packCount(r) > 1).length };
}

/** The ?on= day: a real calendar date, else today (an impossible date such as 2026-02-31 falls back instead of failing the page). */
export function isoDayOrToday(value: string | undefined): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? today : value;
}
