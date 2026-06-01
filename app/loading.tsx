export default function Loading() {
  return (
    <div className="relative flex min-h-[60svh] items-center justify-center overflow-hidden px-6 py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(51,112,169,0.14),transparent_55%)]"
      />

      <div
        role="status"
        aria-live="polite"
        className="relative flex flex-col items-center gap-4"
      >
        <div className="relative h-14 w-14">
          <span className="absolute inset-0 rounded-full border-4 border-slate-200" />
          <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-r-ocean-400 border-t-ocean-500" />
          <span className="absolute inset-3 animate-pulse rounded-full bg-ocean-100" />
        </div>

        <p className="text-sm font-medium text-slate-600">Loading content...</p>
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}
