export default function DashboardLoading() {
  return (
    <div className="relative flex min-h-[50vh] items-center justify-center overflow-hidden rounded border border-asb-gray-200 bg-white/80 p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(51,112,169,0.14),transparent_55%)]"
      />

      <div
        role="status"
        aria-live="polite"
        className="relative flex items-center gap-3"
      >
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-asb-gray-200 border-t-ocean-600" />
        <span className="text-sm font-semibold text-asb-gray-700">
          Loading page...
        </span>
      </div>
    </div>
  );
}
