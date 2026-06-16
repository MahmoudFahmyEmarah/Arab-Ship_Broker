// Dashboard (overview) — Claude design board, live data + map.
//
// Role-aware:
//   • Admin  → sees ALL open cargos & vessels (discovery) and all matches from
//              both the cargo and the vessel point of view.
//   • Member → sees THEIR OWN cargos & vessels, with matching computed against
//              the whole open market (passed as matchCargos / matchVessels).
import { DashboardBoard } from "@/components/portal/boards";
import {
  loadCargoViews,
  loadVesselViews,
  loadPortCoords,
  loadViewerContext,
} from "@/lib/portal/data";

export default async function DashboardPage() {
  const { role } = await loadViewerContext();
  const isAdmin = role === "admin";

  if (isAdmin) {
    // Admin: everything. The displayed arrays ARE the market, so matching runs
    // across all listings with no separate universe needed.
    const [cargo, vessel] = await Promise.all([loadCargoViews(), loadVesselViews()]);
    const locodes = [
      ...cargo.views.flatMap((c) => [c.route.polCode, c.route.podCode]),
      ...vessel.views.map((v) => v.openPortLocode).filter((x): x is string => !!x),
    ];
    const portCoords = await loadPortCoords(locodes);
    return (
      <DashboardBoard
        cargos={cargo.views}
        vessels={vessel.views}
        source={cargo.source}
        portCoords={portCoords}
      />
    );
  }

  // Member: own listings for display + the open market for matching.
  const [myCargo, myVessel, mktCargo, mktVessel] = await Promise.all([
    loadCargoViews({ mine: true }),
    loadVesselViews({ mine: true }),
    loadCargoViews(),
    loadVesselViews(),
  ]);

  const locodes = [
    ...myCargo.views.flatMap((c) => [c.route.polCode, c.route.podCode]),
    ...myVessel.views.map((v) => v.openPortLocode).filter((x): x is string => !!x),
    ...mktCargo.views.flatMap((c) => [c.route.polCode, c.route.podCode]),
    ...mktVessel.views.map((v) => v.openPortLocode).filter((x): x is string => !!x),
  ];
  const portCoords = await loadPortCoords(locodes);

  return (
    <DashboardBoard
      cargos={myCargo.views}
      vessels={myVessel.views}
      matchCargos={mktCargo.views}
      matchVessels={mktVessel.views}
      source={myCargo.source}
      portCoords={portCoords}
    />
  );
}
