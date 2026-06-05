// Tonnage Market — Claude design discovery board (tier-gated, side map, filters).
import { TonnageMarketBoard } from "@/components/portal/market-boards";
import { loadVesselViews, loadPortCoords } from "@/lib/portal/data";

export default async function TonnageMarketPage() {
  const { views, source } = await loadVesselViews();
  const portCoords = await loadPortCoords(views.map((v) => v.openPortLocode).filter((x): x is string => !!x));
  return <TonnageMarketBoard views={views} source={source} portCoords={portCoords} />;
}
