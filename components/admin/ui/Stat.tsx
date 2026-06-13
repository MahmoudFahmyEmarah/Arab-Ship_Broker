// Admin stat tile (adm-stat). Compact KPI: label, big tabular value with an
// optional accent, and an optional sub line. Becomes a link when `href` is set.
import Link from "next/link";

export type StatAccent = "default" | "red" | "green" | "amber";

export function Stat({
  label,
  value,
  sub,
  accent = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: StatAccent;
  href?: string;
}) {
  const valueCls = `adm-stat__value${accent !== "default" ? ` is-${accent}` : ""}`;
  const inner = (
    <>
      <span className="adm-stat__label">{label}</span>
      <span className={valueCls}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {sub != null && <span className="adm-stat__sub">{sub}</span>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="adm-stat">
        {inner}
      </Link>
    );
  }
  return <div className="adm-stat">{inner}</div>;
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="adm-stats">{children}</div>;
}
