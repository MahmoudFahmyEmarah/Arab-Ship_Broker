import { cn } from "@/lib/utils";

const cards = Array.from({ length: 8 });

export function CargoCardsSkeleton({
  count = cards.length,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const items = Array.from({ length: count });

  return (
    <div
      className={cn(
        "grid gap-4 grid-cols-4 max-[1280px]:grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1",
        className,
      )}
    >
      {items.map((_, index) => (
        <div
          key={`card-${index}`}
          className="bg-white border border-asb-gray-200 rounded p-4 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="h-5 w-20 rounded-full bg-asb-gray-100 animate-pulse" />
            <div className="h-4 w-4 rounded-full bg-asb-gray-200 animate-pulse" />
          </div>
          <div className="space-y-2">
            <div className="h-5 w-40 rounded bg-asb-gray-200 animate-pulse" />
            <div className="h-3 w-24 rounded bg-asb-gray-100 animate-pulse" />
          </div>
          <div className="space-y-3">
            <div className="h-4 w-full rounded bg-asb-gray-100 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-asb-gray-100 animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-asb-gray-100 animate-pulse" />
          </div>
          <div className="h-9 w-full rounded bg-asb-gray-200 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
