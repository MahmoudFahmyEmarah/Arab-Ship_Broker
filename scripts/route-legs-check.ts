/**
 * Route-state unit checks (no network). Run:  npx tsx scripts/route-legs-check.ts
 * Pins the 17 Sep 2026 rule for the cargo card and the dashboard row: the
 * listing's own wording stays on the main line, and a second line names the
 * reference route the figures come from — or says a reference port is
 * required. Uses the owner's screenshot cases (Greece → Syria, Izmail →
 * Egypt Med) with the reference ports the live database nominates.
 */
import { legInfo, noRouteReason, routeEstimate, routeLegs, routeState, type PortNames } from "@/lib/portal/route-legs";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

const names: PortNames = {
  byCode: { GRPIR: "Piraeus", SYLTK: "Lattakia", EGALY: "Alexandria", UAIZM: "Izmail", TRSSX: "Samsun", UARNI: "Reni" },
  byName: { piraeus: "GRPIR", lattakia: "SYLTK", alexandria: "EGALY", izmail: "UAIZM", samsun: "TRSSX", reni: "UARNI" },
};
const cargo = (pol: ReturnType<typeof legInfo>, pod: ReturnType<typeof legInfo>) =>
  routeLegs({ route: { polName: pol.label, polCode: pol.code ?? "", polZone: pol.zone ?? "", podName: pod.label, podCode: pod.code ?? "", podZone: pod.zone ?? "" }, polLeg: pol, podLeg: pod });

console.log("area → area (Greece → Syria)");
{
  const legs = cargo(
    legInfo(null, "Greece", "E.MED", names, { scope: "area", refCode: "GRPIR" }),
    legInfo(null, "Syria", "E.MED", names, { scope: "area", refCode: "SYLTK" }),
  );
  ok(legs.pol.label === "Greece" && legs.pod.label === "Syria", "main line keeps the listing's wording");
  ok(legs.pol.kind === "area" && legs.pod.kind === "area", "both legs marked area");
  ok(routeState(legs) === "estimated", "state is estimated");
  ok(routeEstimate(legs)?.text === "Estimated via Piraeus → Lattakia", `second line: ${routeEstimate(legs)?.text}`);
  ok(legs.polCode === "GRPIR" && legs.podCode === "SYLTK", "calculators receive the reference LOCODEs");
}

console.log("port → area (Izmail → Egypt Med)");
{
  const legs = cargo(
    legInfo("UAIZM", "Izmail", "B.SEA", names, { scope: "port", refCode: "UAIZM" }),
    legInfo(null, "Egypt Med", "E.MED", names, { scope: "area", refCode: "EGALY" }),
  );
  ok(routeState(legs) === "estimated", "state is estimated");
  ok(routeEstimate(legs)?.text === "Estimated via Izmail → Alexandria", `second line: ${routeEstimate(legs)?.text}`);
  ok(legs.pol.kind === "port" && legs.pod.kind === "area", "only the discharge leg is marked area");
}

console.log("exact port → port");
{
  const legs = cargo(
    legInfo("UAIZM", "Izmail", "B.SEA", names, { scope: "port", refCode: "UAIZM" }),
    legInfo("TRSSX", "Samsun", "B.SEA", names, { scope: "port", refCode: "TRSSX" }),
  );
  ok(routeState(legs) === "exact", "state is exact");
  ok(routeEstimate(legs) === null, "no second line");
}

console.log("alternatives (Izmail or Reni → Samsun)");
{
  const legs = cargo(
    legInfo(null, "Izmail or Reni", "B.SEA", names, { scope: "options", refCode: "UAIZM" }),
    legInfo("TRSSX", "Samsun", "B.SEA", names, { scope: "port", refCode: "TRSSX" }),
  );
  ok(legs.pol.kind === "alt" && legs.pol.label === "Izmail or Reni", "alt leg keeps its wording");
  ok(routeEstimate(legs)?.text === "Estimated via Izmail → Samsun", `second line: ${routeEstimate(legs)?.text}`);
}

console.log("unplaceable text with a LOCODE in slot 2 (scope none + reference)");
{
  const legs = cargo(
    legInfo(null, "Somewhere Danube", "B.SEA", names, { scope: "none", refCode: "UARNI" }),
    legInfo("TRSSX", "Samsun", "B.SEA", names, { scope: "port", refCode: "TRSSX" }),
  );
  ok(legs.pol.kind === "area" && legs.pol.alternatives.length === 0, "shown as an area, not as alternatives");
  ok(routeState(legs) === "estimated" && routeEstimate(legs)?.text === "Estimated via Reni → Samsun", `second line: ${routeEstimate(legs)?.text}`);
}

console.log("area with no reference port (Izmail → Israel)");
{
  const legs = cargo(
    legInfo("UAIZM", "Izmail", "B.SEA", names, { scope: "port", refCode: "UAIZM" }),
    legInfo(null, "Israel", "E.MED", names, { scope: "area", refCode: null }),
  );
  ok(routeState(legs) === "invalid", "state is invalid");
  const est = routeEstimate(legs);
  ok(est?.state === "invalid" && est.text === "Reference port required", `second line: ${est?.text}`);
  ok(!!est && est.detail === noRouteReason(legs), "tooltip carries the plain-language reason");
  ok(!/Estimated via/.test(est?.text ?? ""), "never claims an estimated route without a reference port");
}

console.log("zone only (no port on either side)");
{
  const legs = cargo(legInfo(null, null, "B.SEA", names, null), legInfo(null, null, "W.MED", names, null));
  ok(routeState(legs) === "invalid", "state is invalid");
  ok(routeEstimate(legs)?.text === "Reference port required", "second line asks for a port");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
