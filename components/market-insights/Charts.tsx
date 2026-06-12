// Market Insights chart set — 1:1 port of the Pre_Final §12 prototype
// renderers (market-insights-render.js) as server components over the frozen
// edition payloads. Same geometry, colors and labels as the design HTML.
import type { InsightBucket } from "@/lib/market-insights";

const nf = new Intl.NumberFormat("en-US");

// Design regime palette (MI_REGIMES)
const REGIME_COLORS: Record<string, string> = {
  "Solid bulk cargo except grain": "#185FA5",
  "Grain & agri": "#27500A",
  "Break-bulk": "#854F0B",
  Other: "#8B95A3",
};

// Design band order (MI_BANDS — en dashes as emitted by the generator)
const BAND_ORDER = ["<10K", "10–20K", "20–35K", "35–50K", "50K+"];

export type TrendPoint = { weekId: string; cargoes: number; positions: number };

function weekShort(weekId: string) {
  const m = weekId.match(/W(\d+)/);
  return m ? `Week ${parseInt(m[1], 10)}` : weekId;
}

// ── Weekly trend — line chart, point-labelled, side padding 44 so the edge
//    week labels never clip (the design's fixed bug). 640×150 viewBox. ──
export function TrendChart({ series }: { series: TrendPoint[] }) {
  if (series.length === 0) return null;
  const W = 640, H = 150, padL = 44, padR = 44, padT = 24, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxV = Math.ceil(Math.max(1, ...series.flatMap((e) => [e.cargoes, e.positions])) * 1.12);
  const x = (i: number) => padL + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / maxV) * innerH;

  const lineFor = (key: "cargoes" | "positions", color: string) => {
    const pts = series.map((e, i) => [x(i), y(e[key])] as const);
    const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    return (
      <g key={key}>
        <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p[0]} cy={p[1]} r={4} fill="#fff" stroke={color} strokeWidth={2.5} />
            <text x={p[0]} y={p[1] - 10} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 700, fill: "#1B3A5C" }} className="tabular-nums">
              {series[i][key]}
            </text>
          </g>
        ))}
      </g>
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Weekly trend</div>
        <div className="flex items-center gap-4 text-[11.5px] font-medium text-slate-600">
          <span className="inline-flex items-center gap-1.5"><span className="w-4 h-[3px] rounded bg-[#1B3A5C]" /> Cargoes posted</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-4 h-[3px] rounded bg-[#3FA0DC]" /> Open positions</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cargoes posted and open positions by week" className="w-full h-auto">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padL} y1={padT + innerH - innerH * f} x2={W - padR} y2={padT + innerH - innerH * f} stroke="#EDF1F6" strokeWidth={1} />
        ))}
        <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="#B6BFCC" strokeWidth={1} />
        {series.map((e, i) => (
          <text key={e.weekId} x={x(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 11, fill: "#8B95A3" }}>
            {weekShort(e.weekId)}
          </text>
        ))}
        {lineFor("positions", "#3FA0DC")}
        {lineFor("cargoes", "#1B3A5C")}
      </svg>
    </div>
  );
}

// ── Cargo regime mix — conic-gradient donut + legend with shares ──
export function RegimeDonut({ items }: { items: InsightBucket[] }) {
  const total = Math.max(1, items.reduce((s, i) => s + i.count, 0));
  let acc = 0;
  const stops = items.map((i) => {
    const start = (acc / total) * 100;
    acc += i.count;
    const end = (acc / total) * 100;
    return `${REGIME_COLORS[i.label] ?? REGIME_COLORS.Other} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-3.5">Cargo regime mix</div>
      <div className="flex items-center gap-5">
        <div className="relative w-[104px] h-[104px] rounded-full shrink-0" style={{ background: `conic-gradient(${stops.join(",")})` }}>
          <div className="absolute inset-[19px] rounded-full bg-white" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {items.map((i) => (
            <div key={i.label} className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: REGIME_COLORS[i.label] ?? REGIME_COLORS.Other }} />
              <span className="flex-1 text-[12.5px] text-slate-600 truncate">{i.label}</span>
              <span className="text-[13px] font-semibold text-[#1B3A5C] tabular-nums">{Math.round((i.count / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Size-band distribution — column chart with count + share labels ──
export function SizeBandColumns({ items }: { items: InsightBucket[] }) {
  const byLabel = new Map(items.map((i) => [i.label, i.count]));
  const cols = BAND_ORDER.map((b) => ({ label: b, count: byLabel.get(b) ?? 0 }));
  const other = byLabel.get("Other");
  if (other) cols.push({ label: "Other", count: other });
  const total = Math.max(1, cols.reduce((s, c) => s + c.count, 0));
  const max = Math.max(1, ...cols.map((c) => c.count));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-3.5">Size-band distribution (MT)</div>
      <div className="flex items-end justify-between gap-3 h-[150px]">
        {cols.map((c) => (
          <div key={c.label} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
            <span className="text-[12px] font-bold text-[#1B3A5C] tabular-nums leading-none">{nf.format(c.count)}</span>
            <span className="text-[10px] text-slate-400 tabular-nums leading-none mt-0.5 mb-1">{Math.round((c.count / total) * 100)}%</span>
            <span
              className={`mi-col-bar w-full max-w-[44px] rounded-t-md ${c.label === "Other" ? "bg-slate-300" : "bg-[#185FA5]"}`}
              style={{ height: `${(c.count / max) * 72}%` }}
            />
            <span className={`text-[10.5px] tabular-nums mt-1.5 ${c.label === "Other" ? "text-slate-400 italic" : "text-slate-500"}`}>{c.label}</span>
          </div>
        ))}
      </div>
      <style>{`
        .mi-col-bar { transform-origin: bottom; animation: mi-col-grow .6s cubic-bezier(.22,1,.36,1) both; }
        @keyframes mi-col-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        @media (prefers-reduced-motion: reduce) { .mi-col-bar { animation: none; } }
      `}</style>
    </div>
  );
}

// ── Top lanes — table with minibars and the typical-band chip ──
export function LanesTable({ items }: { items: (InsightBucket & { band?: string })[] }) {
  const max = Math.max(1, ...items.filter((i) => i.label !== "Other").map((i) => i.count));
  const hasBands = items.some((i) => i.band);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Top lanes</div>
      <table className="w-full">
        <thead>
          <tr className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-slate-400">
            <th className="text-left px-4 py-1.5 font-bold">Lane</th>
            <th className="w-[30%]" />
            <th className="text-right px-2 py-1.5 font-bold">Cargoes</th>
            {hasBands && <th className="text-right px-4 py-1.5 font-bold">Typical band</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((i) => {
            const other = i.label === "Other";
            return (
              <tr key={i.label}>
                <td className={`px-4 py-1.5 text-[13px] ${other ? "text-slate-400 italic" : "text-ocean-950 font-medium"}`}>
                  {other ? "Other" : i.label}
                  {other && <span className="block text-[10px] not-italic text-slate-400">lanes under the 5-cargo floor, rolled up</span>}
                </td>
                <td className="px-2">
                  {!other && (
                    <span className="block h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <span className="block h-full rounded-full bg-[#185FA5]" style={{ width: `${(i.count / max) * 100}%` }} />
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right text-[13px] font-semibold text-ocean-700 tabular-nums">{nf.format(i.count)}</td>
                {hasBands && (
                  <td className="px-4 py-1.5 text-right">
                    {i.band && (
                      <span className={`inline-block text-[10px] font-bold tabular-nums rounded-md px-1.5 py-0.5 ${other ? "bg-slate-100 text-slate-400" : "bg-[#E6F1FB] text-[#185FA5]"}`}>
                        {i.band}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
