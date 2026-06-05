import { Wrench } from "lucide-react";

// Lightweight placeholder for nav destinations that are designed but not yet
// built — keeps the information architecture intact (no 404) and tells the user
// the tool is on the way, instead of a dead link.
export function ComingSoon({
  title,
  blurb,
}: {
  title: string;
  blurb?: string;
}) {
  return (
    <div className="px-6 py-6 md:px-8">
      <div className="max-w-xl mx-auto mt-10 bg-white border border-asb-gray-200 rounded p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-asb-blue-light border border-asb-gray-200 flex items-center justify-center mx-auto mb-4">
          <Wrench className="w-5 h-5 text-asb-blue" />
        </div>
        <h1 className="text-xl font-bold text-asb-navy">{title}</h1>
        <p className="text-asb-gray-500 text-sm mt-2">
          {blurb ?? "This tool is coming soon."}
        </p>
        <span className="inline-block mt-4 text-xs font-bold uppercase tracking-wider text-asb-gray-400 bg-asb-gray-100 border border-asb-gray-200 rounded-full px-3 py-1">
          Coming soon
        </span>
      </div>
    </div>
  );
}
