// Dashboard (overview) — Claude design board, live data + map.
import { DashboardBoard } from "@/components/portal/boards";
import { loadCargoViews, loadVesselViews, loadPortCoords } from "@/lib/portal/data";

export default async function DashboardPage() {
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
