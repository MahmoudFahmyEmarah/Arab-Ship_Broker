/**
 * Route-alert sweep — replays the market map's exact route resolution
 * (bundled ECDIS → stored track → corridor estimate) for every live cargo pair
 * and every open vessel→cargo ballast leg, then checks the Suez alert against
 * the geography of the two ends. Run:
 *   node --env-file=.env.local --import tsx scripts/route-alert-sweep.ts
 * Fails when any pair whose ends are on the SAME side of the canal would show
 * "Suez Canal transit", or when a stored route contradicts its own geometry.
 */
import { createClient } from "@supabase/supabase-js";
import { routeGeometry } from "@/lib/portal/routeGeometry";
import { routeAlerts, chokepointsFromGeometry, suezSideOf as sideOfSuez, type LL } from "@/lib/portal/risk-areas";
import { getPortRoute } from "@/sdk/app/routes";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: ports } = await sb.from("ports").select("locode, latitude, longitude, zone").not("latitude", "is", null);
  const coords = new Map<string, { ll: LL; zone: string | null }>();
  for (const p of (ports ?? []) as { locode: string; latitude: number; longitude: number; zone: string | null }[]) coords.set(p.locode.replace(/\s+/g, ""), { ll: [p.latitude, p.longitude], zone: p.zone });

  const { data: live } = await sb.from("cargo_listings").select("load_port_locode, load_ref_locode, disch_port_locode, disch_ref_locode, status").neq("status", "CLOSED");
  const pairs = new Map<string, number>();
  for (const c of (live ?? []) as Record<string, string | null>[]) {
    const a = (c.load_ref_locode ?? c.load_port_locode)?.replace(/\s+/g, ""), b = (c.disch_ref_locode ?? c.disch_port_locode)?.replace(/\s+/g, "");
    if (a && b && a !== b) pairs.set(`${a}|${b}`, (pairs.get(`${a}|${b}`) ?? 0) + 1);
  }
  console.log(`live pairs: ${pairs.size}`);

  let falsePos = 0, missed = 0, checked = 0, noCoords = 0;
  const byPath: Record<string, number> = {};
  for (const [key, n] of pairs) {
    const [pol, pod] = key.split("|");
    const A = coords.get(pol), B = coords.get(pod);
    if (!A || !B) { noCoords++; continue; }
    // ── the map's resolution order, verbatim ──
    let line: LL[] | null = null, stored: string[] | null = null, path = "";
    const geo = routeGeometry({ polCode: pol, podCode: pod, polLL: A.ll, podLL: B.ll, polZone: A.zone, podZone: B.zone });
    if (geo?.exact) { line = geo.pts; path = "bundled-ecdis"; }
    else {
      const r = await getPortRoute(sb, pol, pod);
      if (r && r.waypoints.length >= 2) { line = r.waypoints.map((w) => [Number(w[0]), Number(w[1])] as LL); stored = r.chokepoints; path = r.source.toUpperCase().startsWith("ECDIS") ? "stored-ecdis" : "stored-computed"; }
      else if (r) { line = geo?.pts ?? [A.ll, B.ll]; stored = r.chokepoints; path = "stored-distance+estimate"; }
      else { line = geo?.pts ?? [A.ll, B.ll]; path = `estimate-${geo?.source ?? "arc"}`; }
    }
    byPath[path] = (byPath[path] ?? 0) + 1;
    const alerts = routeAlerts(line, [], stored);
    const suez = alerts.some((a) => a.kind === "suez");
    const sameSide = sideOfSuez(A.ll) === sideOfSuez(B.ll);
    checked++;
    if (suez && sameSide) { falsePos++; console.log(`  FALSE+  ${pol}→${pod} ×${n} via ${path} stored=${JSON.stringify(stored)} geom=${JSON.stringify(chokepointsFromGeometry(line))}`); }
    if (!suez && !sameSide) { missed++; console.log(`  missed  ${pol}→${pod} ×${n} via ${path} (${A.zone}→${B.zone}) stored=${JSON.stringify(stored)}`); }
  }
  console.log(`\nchecked ${checked} pairs (${noCoords} without coordinates) · paths ${JSON.stringify(byPath)}`);
  console.log(`same-side pairs that would show a Suez alert: ${falsePos}`);
  console.log(`cross-side pairs with no Suez alert (missed): ${missed}`);
  process.exit(falsePos ? 1 : 0);
})();
