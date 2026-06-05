// My Vessels — Claude design fleet board (dense cards + Leaflet fleet map with
// preferred-direction vectors). Functional filters + Show/Hide map.
import { MyVesselsFleetBoard } from "@/components/portal/MyVesselsFleetBoard";
import { loadVesselViews, loadPortCoords } from "@/lib/portal/data";

export default async function MyVesselsPage() {
  const { views, source } = await loadVesselViews({ mine: true });
  const portCoords = await loadPortCoords(views.map((v) => v.openPortLocode).filter((x): x is string => !!x));
  return <MyVesselsFleetBoard views={views} source={source} portCoords={portCoords} />;
}
