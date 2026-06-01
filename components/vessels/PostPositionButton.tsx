"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface PostPositionButtonProps {
  vesselId: string;
  disabled?: boolean;
  title?: string;
}

export function PostPositionButton({
  vesselId,
  disabled = false,
  title,
}: PostPositionButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) {
          router.push(`/dashboard/vessels/${vesselId}/availability/new`);
        }
      }}
      disabled={disabled}
      title={disabled ? title : undefined}
      className={cn(
        "shrink-0 flex items-center gap-2 bg-asb-blue text-white font-semibold px-5 py-2.5 rounded text-sm transition-colors shadow-sm",
        disabled ? "bg-asb-gray-400 cursor-not-allowed" : "hover:bg-asb-blue",
      )}
    >
      <Plus className="w-4 h-4" />
      Post position
    </button>
  );
}
