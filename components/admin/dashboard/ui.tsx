"use client";

// Building blocks of the console dashboard (design: Admin Dashboard.html):
// terminal-card panels, inner boxes, KPI tiles with sparklines, state dots
// and pills, stacked mix bars. Colours come from the .adb-* classes in
// app/(admin)/admin-dashboard.css — nothing here hard-codes a hue.
import * as React from "react";
import Link from "next/link";
import type { Level } from "@/lib/admin/dashboard/types";
import { sparkPoints } from "@/lib/admin/dashboard/model";

export function Panel({
  label, title, sub, right, children, stale, info,
}: {
  label: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode;
  children: React.ReactNode; stale?: boolean; info?: string;
}) {
  return (
    <section className={`adb-panel${stale ? " is-stale" : ""}`} data-screen-label={label}>
      <div className="adb-panel__head">
        <div className="adb-panel__titles">
          <div className="adb-panel__title">
            {title}
            {info && <span className="adb-info" title={info} aria-label={info}>i</span>}
          </div>
          {sub && <div className="adb-panel__sub">{sub}</div>}
        </div>
        <span className="adb-spacer" />
        {right}
      </div>
      {children}
    </section>
  );
}

export function Box({ title, children, className, right }: { title?: React.ReactNode; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={`adb-box${className ? ` ${className}` : ""}`}>
      {title && (
        <div className="adb-box__head">
          <span className="adb-box__title">{title}</span>
          {right && <span className="adb-box__right">{right}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Fresh({ text, level = "ok" }: { text: React.ReactNode; level?: Level }) {
  return (
    <span className="adb-fresh">
      <Dot level={level} size={6} />
      {text}
    </span>
  );
}

export function SourcePill({ text, title }: { text: string; title?: string }) {
  return <span className="adb-src" title={title}>{text}</span>;
}

export function Dot({ level, size = 8, pulse }: { level: Level; size?: number; pulse?: boolean }) {
  return <span className={`adb-dot is-${level}${pulse ? " is-pulse" : ""}`} style={{ width: size, height: size }} aria-hidden />;
}

export function StatePill({ level, text }: { level: Level; text: string }) {
  return <span className={`adb-state is-${level}`}>{text}</span>;
}

export function Sparkline({ data, w = 80, h = 24, width, height, className }: { data: number[]; w?: number; h?: number; width?: number; height?: number; className?: string }) {
  if (!data.length) return null;
  const s = sparkPoints(data, w, h);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={width ?? w} height={height ?? h} className={`adb-spark${className ? ` ${className}` : ""}`} aria-hidden>
      <polyline points={s.points} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="adb-spark__line" />
      <circle cx={s.lastX} cy={s.lastY} r={2.2} className="adb-spark__dot" />
    </svg>
  );
}

export function Tile({
  label, value, sub, delta, deltaLevel, spark, href, valueLevel, external, tone,
}: {
  label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; delta?: React.ReactNode; deltaLevel?: Level;
  spark?: number[]; href?: string; valueLevel?: Level; external?: boolean; tone?: "amber";
}) {
  const body = (
    <>
      <div className="adb-tile__label">{label}</div>
      <div className="adb-tile__row">
        <div className={`adb-tile__value${valueLevel ? ` is-${valueLevel}` : ""}`}>{value}</div>
        {spark && spark.length > 1 && <Sparkline data={spark} className="adb-tile__spark" />}
      </div>
      {(delta || sub) && (
        <div className="adb-tile__foot">
          {delta && <span className={`adb-tile__delta${deltaLevel ? ` is-${deltaLevel}` : ""}`}>{delta}</span>}
          {sub && <span className="adb-tile__sub">{sub}</span>}
        </div>
      )}
    </>
  );
  const cls = `adb-tile${tone ? ` is-${tone}` : ""}`;
  if (href && external) return <a href={href} className={cls} target="_blank" rel="noreferrer">{body}</a>;
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  return <div className={cls}>{body}</div>;
}

export function Mix({ parts, height = 8, className }: { parts: { pct: number; className: string; title: string }[]; height?: number; className?: string }) {
  const shown = parts.filter((p) => p.pct > 0);
  return (
    <div className={`adb-mix${className ? ` ${className}` : ""}`} style={{ height }}>
      {shown.length === 0 ? <div className="adb-mix__part is-empty" style={{ width: "100%" }} title="No data" /> :
        shown.map((p) => <div key={p.title} className={`adb-mix__part ${p.className}`} style={{ width: `${p.pct}%` }} title={p.title} />)}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="adb-empty">{children}</div>;
}
