import { NextRequest, NextResponse } from "next/server";
import REF from "@/lib/portal/ports-reference.json";

// Full UN/LOCODE port typeahead (≈13.5k ports from upply-seaports). Server-side
// only (the JSON isn't shipped to the client). The curated `ports` table still
// answers first in PortAutocomplete; this backstops it so ANY port is findable.
type P = { c: string; n: string; co: string; z: string; lat: number | null; lon: number | null };
const PORTS = REF as P[];

export function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  const ql = q.toLowerCase();
  const qu = q.toUpperCase().replace(/\s+/g, "");
  const scored: { p: P; s: number }[] = [];
  for (const p of PORTS) {
    let s = 0;
    if (p.c === qu) s = 100;
    else if (p.c.startsWith(qu)) s = 80;
    else {
      const nl = p.n.toLowerCase();
      if (nl.startsWith(ql)) s = 60;
      else if (nl.includes(ql)) s = 40;
    }
    if (s > 0) scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s || a.p.n.localeCompare(b.p.n));
  const results = scored.slice(0, 12).map(({ p }) => ({
    locode: p.c,
    trade_name: p.n,
    country: p.co,
    zone: p.z,
    port_type: "Sea Port",
  }));
  return NextResponse.json({ results });
}
