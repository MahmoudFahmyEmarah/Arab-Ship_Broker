import { CargoForm } from "@/components/cargo/CargoForm";
import { ProfileGuard } from "@/components/ProfileGuard";

export default function CreateCargoPage() {
  return (
    <ProfileGuard requires="cargo">
      <div className="py-2 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-asb-navy">Post New Cargo</h1>
          <p className="text-sm text-asb-gray-500 mt-1">
            Select your commodity, ports, and laycan. Safety requirements load
            automatically.
          </p>
        </div>
        <CargoForm mode="create" />
      </div>
    </ProfileGuard>
  );
}
