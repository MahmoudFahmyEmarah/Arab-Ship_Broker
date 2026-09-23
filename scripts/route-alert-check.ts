/**
 * Route-alert unit checks (no network). Run:  npx tsx scripts/route-alert-check.ts
 * Pins the owner's rule of 12 Sep 2026: a Suez Canal transit alert is only
 * ever raised for a route whose two ends lie on opposite sides of the canal,
 * whatever a stored tag or the box test says — using the real ECDIS track for
 * Sfax ↔ Port Said that raised the false alert on 9 Sep.
 */
import { routeAlerts, chokepointsFromGeometry, suezSideOf, suezPlausible, type LL } from "@/lib/portal/risk-areas";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const hasSuez = (a: ReturnType<typeof routeAlerts>) => a.some((x) => x.kind === "suez");

// The stored ECDIS track EGPSD → TNSFA (port_routes 49329184…, 15 waypoints, 1,132 NM)
const PSD_SFAX: LL[] = [[31.212,32.355],[31.194167,32.305133],[31.23435,32.304817],[31.247917,32.30625],[31.270483,32.320783],[31.302083,32.35],[31.462517,32.297933],[31.540817,32.227933],[31.752133,31.977133],[31.818783,31.87295],[33.104467,22.2387],[33.21075,20.562367],[34.39935,11.169933],[34.70005,10.80005],[34.727,10.77]];
// A genuine transit: Alexandria → Aqaba through the canal (bundled ECDIS EGALY|JOAQJ, abridged)
const ALY_AQJ: LL[] = [[31.1892,29.8708],[31.6494,30.3047],[31.7542,31.9489],[31.4014,32.3008],[31.1003,32.3081],[30.7867,32.3161],[30.5089,32.3386],[30.2489,32.5336],[29.97,32.5867],[29.6167,32.515],[28.3511,33.1583],[27.4903,34.0811],[29.3528,34.8825],[29.5172,34.9967]];

console.log("suezSideOf");
ok(suezSideOf([31.25, 32.30]) === "N", "Port Said is N");
ok(suezSideOf([34.74, 10.76]) === "N", "Sfax is N");
ok(suezSideOf([29.97, 32.55]) === "S", "Suez town is S");
ok(suezSideOf([29.52, 35.00]) === "S", "Aqaba is S");
ok(suezSideOf([21.49, 39.19]) === "S", "Jeddah is S");
ok(suezSideOf([30.42, 49.08]) === "S", "Bandar Imam Khomeini (Gulf head, 30.4N) is S");
ok(suezSideOf([44.75, 37.75]) === "N", "Novorossiysk (37.75E) is N");
ok(suezSideOf([6.45, 3.40]) === "N", "Lagos (Atlantic) is N");
ok(suezSideOf([31.23, 121.47]) === "S", "Shanghai (31N but 121E) is S");
ok(suezSideOf([33.90, 35.50]) === "N", "Beirut (Levant, 33.9N 35.5E) is N");
ok(suezSideOf([-33.9, 18.42]) === "N", "Cape Town is N (never same-side with the Red Sea, so geometry decides)");

console.log("the owner's case — Sfax ↔ Port Said");
ok(chokepointsFromGeometry(PSD_SFAX).length === 0, "tight boxes: the ECDIS track touches no chokepoint");
ok(!suezPlausible(PSD_SFAX), "both ends on the Med side → a transit is implausible");
ok(!hasSuez(routeAlerts(PSD_SFAX, [], [])), "no alert with a clean stored tag");
ok(!hasSuez(routeAlerts(PSD_SFAX, [], ["SUEZ"])), "no alert even if a stale stored tag says SUEZ");
ok(!hasSuez(routeAlerts([...PSD_SFAX].reverse(), [], ["SUEZ"])), "…in either direction");
ok(!hasSuez(routeAlerts([[31.25, 32.30], [30.9, 32.4], [31.25, 32.30]], [], null)), "a track dipping into the box but returning to the same side is not a transit");

console.log("genuine transits still alert");
ok(chokepointsFromGeometry(ALY_AQJ).includes("SUEZ"), "Alexandria → Aqaba geometry crosses the canal box");
ok(suezPlausible(ALY_AQJ) && hasSuez(routeAlerts(ALY_AQJ, [], null)), "…and raises the alert from geometry alone");
ok(hasSuez(routeAlerts([[31.25, 32.30], [21.49, 39.19]], [], ["SUEZ"])), "Port Said → Jeddah with a stored tag alerts");
ok(hasSuez(routeAlerts([[44.75, 37.75], [11.6, 43.15]], [], ["SUEZ", "BOSPHORUS", "DARDANELLES", "BAB_EL_MANDEB"])), "Novorossiysk → Djibouti alerts");
ok(hasSuez(routeAlerts([[6.45, 3.40], [21.49, 39.19]], [], ["SUEZ", "GIBRALTAR"])), "Lagos → Jeddah alerts");
ok(!hasSuez(routeAlerts([[21.49, 39.19], [29.52, 35.00]], [], ["SUEZ"])), "Jeddah → Aqaba (both S) never alerts");
ok(!hasSuez(routeAlerts([[-33.9, 18.42], [21.49, 39.19]], [], null)), "Cape Town → Jeddah: cross-side but geometry never enters the canal → no alert");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
