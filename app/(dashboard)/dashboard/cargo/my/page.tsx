// My Cargo — Claude design board (functional filters, Show/Hide map, detail panel).
import { CargoBoard } from "@/components/portal/boards";
import { ProfileGuard } from "@/components/ProfileGuard";
import { loadCargoViews, loadPortCoords } from "@/lib/portal/data";

export default async function MyCargoPage() {
  const { views, source } = await loadCargoViews({ mine: true });
  const portCoords = await loadPortCoords(views.flatMap((c) => [c.route.polCode, c.route.podCode]));
  return (
    <ProfileGuard requires="cargo">
      <CargoBoard views={views} variant="my" source={source} portCoords={portCoords} postHref="/dashboard/cargo/create" />
    </ProfileGuard>
  );
}
