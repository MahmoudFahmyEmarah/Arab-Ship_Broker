"use client";

import { useMemo } from "react";
import type { ActivityDay } from "@/lib/admin/types";

interface ActivityChartProps {
  data: ActivityDay[];
}

const SERIES = [
  { key: "cargo_submitted" as const, label: "Cargo posted", color: "#3370a9" },
  {
    key: "vessel_submitted" as const,
    label: "Vessel posted",
    color: "#2bb9d3",
  },
  { key: "approved" as const, label: "Approved", color: "#22c55e" },
  { key: "rejected" as const, label: "Rejected", color: "#ef4444" },
] as const;

export function ActivityChart({ data }: ActivityChartProps) {
  const maxVal = useMemo(() => {
    if (!data.length) return 1;
    return Math.max(
      1,
      ...data.flatMap((d) => SERIES.map((s) => d[s.key] ?? 0)),
    );
  }, [data]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-asb-gray-400 text-sm">
        No activity data yet.
      </div>
    );
  }

  const chartHeight = 160;
  const barGroupWidth = 16;
  const barGap = 2;
  const barWidth =
    (barGroupWidth - barGap * (SERIES.length - 1)) / SERIES.length;
  const groupGap = 6;
  const totalWidth = data.length * (barGroupWidth + groupGap);

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-5 flex-wrap">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-xs text-asb-gray-500">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="overflow-x-auto">
        <svg
          width={Math.max(totalWidth, 400)}
          height={chartHeight + 28}
          className="overflow-visible"
        >
          {/* Y-axis guide lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
            <g key={pct}>
              <line
                x1={0}
                x2={Math.max(totalWidth, 400)}
                y1={chartHeight - pct * chartHeight}
                y2={chartHeight - pct * chartHeight}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={-4}
                y={chartHeight - pct * chartHeight + 4}
                textAnchor="end"
                fontSize={9}
                fill="#94a3b8"
              >
                {Math.round(pct * maxVal)}
              </text>
            </g>
          ))}

          {/* Bars */}
          {data.map((day, gi) => {
            const groupX = gi * (barGroupWidth + groupGap);
            // Show date label every ~7 days
            const showLabel = gi % 7 === 0 || gi === data.length - 1;
            const dateLabel = new Date(day.day).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            });

            return (
              <g key={day.day} transform={`translate(${groupX}, 0)`}>
                {SERIES.map((s, si) => {
                  const val = day[s.key] ?? 0;
                  const barH = (val / maxVal) * chartHeight;
                  const x = si * (barWidth + barGap);
                  return (
                    <g key={s.key}>
                      <rect
                        x={x}
                        y={chartHeight - barH}
                        width={barWidth}
                        height={barH}
                        fill={s.color}
                        rx={1}
                        opacity={0.85}
                      >
                        <title>
                          {s.label}: {val} on {day.day}
                        </title>
                      </rect>
                    </g>
                  );
                })}
                {showLabel && (
                  <text
                    x={barGroupWidth / 2}
                    y={chartHeight + 14}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#94a3b8"
                  >
                    {dateLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
