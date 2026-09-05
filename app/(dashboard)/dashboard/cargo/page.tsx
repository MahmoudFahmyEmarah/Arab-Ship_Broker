// Cargo Market — Claude design discovery board (tier-gated, side map, filters).
import { CargoMarketBoard } from "@/components/portal/market-boards";
import { loadCargoViews, loadVesselViews, loadPortCoords } from "@/lib/portal/data";

export default async function CargoMarketPage() {
  const [{ views, source, archiveLabel }, tonnage] = await Promise.all([loadCargoViews(), loadVesselViews()]);
  const portCoords = await loadPortCoords(views.flatMap((c) => [c.route.polCode, c.route.podCode]));
  return <CargoMarketBoard views={views} source={source} portCoords={portCoords} archiveLabel={archiveLabel} matchPool={tonnage.views} />;
}
