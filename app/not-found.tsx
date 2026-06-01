import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-[70svh] items-center justify-center overflow-hidden px-6 py-20 max-[768px]:py-14">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(51,112,169,0.16),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(43,185,211,0.14),transparent_36%)]"
      />

      <section className="relative w-full max-w-2xl rounded-2xl border border-slate-200/80 bg-white/90 p-12 max-[768px]:p-8 shadow-xl shadow-slate-900/5 backdrop-blur-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-ocean-600">
          Page not found
        </p>

        <h1 className="mt-3 text-7xl max-[768px]:text-6xl font-bold tracking-tight text-slate-900">
          404
        </h1>

        <p className="mt-5 max-w-xl text-lg max-[768px]:text-base leading-relaxed text-slate-600">
          We could not find the page you were looking for. It may have moved,
          been renamed, or no longer be available.
        </p>

        <Link
          href="/"
          className="mt-8 inline-flex items-center justify-center rounded-lg bg-ocean-500 px-6 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-ocean-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2"
        >
          Go back home
        </Link>
      </section>
    </main>
  );
}
