export default function QueueLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-48 bg-asb-gray-200 rounded" />
        <div className="h-4 w-36 bg-asb-gray-100 rounded-lg" />
      </div>

      <div className="flex gap-1 bg-white border border-asb-gray-200 rounded p-1 w-fit">
        {[80, 72, 68, 60, 48].map((w, i) => (
          <div
            key={i}
            className="h-8 rounded-lg bg-asb-gray-100"
            style={{ width: `${w}px` }}
          />
        ))}
      </div>

      <div className="bg-white border border-asb-gray-200 rounded overflow-hidden">
        <div className="h-10 bg-asb-gray-50 border-b border-asb-gray-100" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-5 py-4 border-b border-asb-gray-100 last:border-0"
          >
            <div className="w-8 h-8 bg-asb-gray-100 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-3/4 bg-asb-gray-200 rounded" />
              <div className="h-3 w-1/2 bg-asb-gray-100 rounded" />
            </div>
            <div className="w-20 h-5 bg-asb-gray-100 rounded-md" />
            <div className="w-16 h-5 bg-asb-gray-100 rounded-md" />
            <div className="w-12 h-4 bg-asb-gray-100 rounded" />
            <div className="w-4 h-4 bg-asb-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
