import { CargoForm } from "@/components/cargo/CargoForm";
import { ProfileGuard } from "@/components/ProfileGuard";
import { PostingAsChip } from "@/components/portal/PostingAsChip";

export default function CreateCargoPage() {
  return (
    <ProfileGuard requires="cargo">
      <div className="px-6 py-6 md:px-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-asb-navy">Post New Cargo</h1>
            <p className="text-sm text-asb-gray-500 mt-1">
              Select your commodity, ports, and laycan. Safety requirements load
              automatically.
            </p>
          </div>
          <PostingAsChip />
        </div>
        <CargoForm mode="create" />
      </div>
    </ProfileGuard>
  );
}
