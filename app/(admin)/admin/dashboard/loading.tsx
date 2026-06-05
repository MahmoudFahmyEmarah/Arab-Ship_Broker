export default function AdminDashboardLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-64 bg-asb-gray-200 rounded" />
        <div className="h-4 w-48 bg-asb-gray-100 rounded-lg" />
      </div>

      {[0, 1, 2].map((row) => (
        <div key={row} className="space-y-3">
          <div className="h-3 w-32 bg-asb-gray-100 rounded" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((col) => (
              <div
                key={col}
                className="bg-white rounded border border-asb-gray-200 p-5 space-y-3"
              >
                <div className="w-9 h-9 bg-asb-gray-100 rounded" />
                <div className="space-y-1.5">
                  <div className="h-7 w-16 bg-asb-gray-200 rounded" />
                  <div className="h-3 w-24 bg-asb-gray-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 bg-white rounded border border-asb-gray-200 p-6">
          <div className="h-4 w-32 bg-asb-gray-200 rounded mb-6" />
          <div className="h-48 bg-asb-gray-50 rounded" />
        </div>
        <div className="lg:col-span-2 bg-white rounded border border-asb-gray-200 p-6">
          <div className="h-4 w-40 bg-asb-gray-200 rounded mb-4" />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex gap-3 p-3 rounded border border-asb-gray-100"
              >
                <div className="w-8 h-8 bg-asb-gray-100 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-full bg-asb-gray-200 rounded" />
                  <div className="h-3 w-3/4 bg-asb-gray-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
