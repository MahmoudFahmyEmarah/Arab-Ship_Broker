"use client";

import { CargoCardsSkeleton } from "@/components/cargo/CargoCardsSkeleton";
import { useCargoFilterTransition } from "@/components/cargo/CargoFilterTransitionProvider";

export function CargoResultsShell({ children }: { children: React.ReactNode }) {
  const transition = useCargoFilterTransition();

  return (
    <div className="relative">
      {children}
      {transition?.isPending && (
        <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] rounded-2xl pointer-events-none">
          <div className="p-1">
            <CargoCardsSkeleton className="pointer-events-none" />
          </div>
        </div>
      )}
    </div>
  );
}
