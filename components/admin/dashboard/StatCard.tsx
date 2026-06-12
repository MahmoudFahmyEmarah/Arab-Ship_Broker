import Link from "next/link";
import { cn } from "@/lib/utils";

type StatCardAccent = "ocean" | "green" | "amber" | "red" | "slate" | "coral";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  accent?: StatCardAccent;
  href?: string;
  hint?: string;
  urgent?: boolean;
}

const ACCENT_MAP: Record<
  StatCardAccent,
  { icon: string; value: string; border: string }
> = {
  ocean: {
    icon: "text-asb-blue bg-asb-blue-light",
    value: "text-asb-navy",
    border: "border-asb-gray-200",
  },
  green: {
    icon: "text-green-600 bg-green-50",
    value: "text-green-900",
    border: "border-asb-gray-200",
  },
  amber: {
    icon: "text-amber-600 bg-amber-50",
    value: "text-amber-900",
    border: "border-asb-gray-200",
  },
  red: {
    icon: "text-red-600 bg-red-50",
    value: "text-red-900",
    border: "border-asb-gray-200",
  },
  slate: {
    icon: "text-asb-gray-500 bg-asb-gray-100",
    value: "text-asb-ink-soft",
    border: "border-asb-gray-200",
  },
  coral: {
    icon: "text-coral-600 bg-coral-50",
    value: "text-coral-900",
    border: "border-asb-gray-200",
  },
};

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "ocean",
  href,
  hint,
  urgent = false,
}: StatCardProps) {
  const styles = ACCENT_MAP[accent];

  const content = (
    <div
      className={cn(
        "h-full min-h-34 dp-card p-5 transition-all flex flex-col justify-between",
        urgent && "ring-1 ring-inset ring-red-200",
        href && "dp-clickable cursor-pointer",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "w-9 h-9 rounded flex items-center justify-center shrink-0",
            styles.icon,
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
        {urgent && (
          <span className="relative flex h-2 w-2 mt-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
        )}
      </div>
      <div>
        <p className={cn("text-2xl font-bold tabular-nums", styles.value)}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        <p className="text-xs text-asb-gray-500 font-medium mt-0.5">{label}</p>
        <p
          className="text-[11px] text-asb-gray-400 mt-1 min-h-4"
          aria-hidden={!hint}
        >
          {hint ?? ""}
        </p>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block h-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:border-asb-blue focus-visible:ring-offset-2"
      >
        {content}
      </Link>
    );
  }

  return content;
}
