// Tonnage Market — Claude design discovery board (tier-gated, side map, filters).
import { TonnageMarketBoard } from "@/components/portal/market-boards";
import { loadVesselViews, loadCargoViews, loadPortCoords } from "@/lib/portal/data";

export default async function TonnageMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialListingKey =
    typeof params.listing === "string" ? params.listing : undefined;
  const [{ views, source }, cargo] = await Promise.all([loadVesselViews(), loadCargoViews()]);
  const portCoords = await loadPortCoords(views.map((v) => v.openPortLocode).filter((x): x is string => !!x));
  return <TonnageMarketBoard key={initialListingKey ?? "all"} views={views} source={source} portCoords={portCoords} matchPool={cargo.views} initialListingKey={initialListingKey} />;
}
