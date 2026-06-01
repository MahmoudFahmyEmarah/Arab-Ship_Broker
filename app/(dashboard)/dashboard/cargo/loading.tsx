import { CargoCardsSkeleton } from "@/components/cargo/CargoCardsSkeleton";

export default function CargoLoading() {
  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-row justify-between items-center gap-4 max-[768px]:flex-col max-[768px]:items-start">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-lg bg-slate-200 animate-pulse" />
          <div className="h-4 w-56 rounded-md bg-slate-100 animate-pulse" />
        </div>
        <div className="h-10 w-36 rounded-xl bg-slate-200 animate-pulse" />
      </div>

      <div className="w-full bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex flex-wrap divide-x divide-slate-100">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={`stat-${index}`}
              className="flex items-center gap-3 px-5 py-3.5 flex-1 min-w-27.5"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-200 animate-pulse" />
              <div className="space-y-1">
                <div className="h-3 w-20 rounded bg-slate-100 animate-pulse" />
                <div className="h-5 w-10 rounded bg-slate-200 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm">
        <div className="h-10 w-full rounded-xl bg-slate-100 animate-pulse" />
      </div>

      <CargoCardsSkeleton />
    </div>
  );
}
