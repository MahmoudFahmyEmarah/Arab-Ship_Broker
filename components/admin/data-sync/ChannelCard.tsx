"use client";

// The Intake tab's channel card — one uniform shell for all three sources
// (workbook upload, circulation inbox, WhatsApp), so an operator reads them the
// same way: what it is, whether it is live, when it last ran, when it runs next,
// and the two things you can do with it (run it, or dry-run it).
//
// Purely presentational. Each source keeps its own logic and passes it in; this
// file never touches an action.

import type * as React from "react";
import { Badge, Card, type BadgeTone } from "./ui";

export function ChannelCard({
  icon, abbr, iconBg, iconColor, name, status, statusTone, desc,
  last, lastTone, next, actions, children, footer,
}: {
  /** Glyph for the channel. When absent, `abbr` is rendered as a wordmark. */
  icon?: React.ReactNode;
  abbr: string;
  iconBg: string;
  iconColor: string;
  name: string;
  status: string;
  statusTone: BadgeTone;
  desc: string;
  /** "Last run" fact — free text, already formatted by the caller. */
  last: React.ReactNode;
  /** Tints the Last-run value when the channel needs attention. */
  lastTone?: string;
  /** "Next scheduled" fact. */
  next: React.ReactNode;
  /** Primary + secondary buttons. */
  actions: React.ReactNode;
  /** Expandable body (sample panel, log). */
  children?: React.ReactNode;
  /** Small print under everything. */
  footer?: React.ReactNode;
}) {
  return (
    <Card className="ds-channel">
      <div className="ds-channel__head">
        <span className="ds-channel__icon" style={{ background: iconBg, color: iconColor }} aria-hidden>
          {icon ?? abbr}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="ds-channel__name">{name}</span>
            <Badge tone={statusTone}>{status}</Badge>
          </div>
          <div className="ds-channel__desc" style={{ marginTop: 3 }}>{desc}</div>
        </div>
      </div>

      <div className="ds-channel__facts">
        <div>
          <div className="ds-channel__factlabel">Last run</div>
          <div className="ds-channel__factvalue" style={lastTone ? { color: lastTone } : undefined}>{last}</div>
        </div>
        <div>
          <div className="ds-channel__factlabel">Next scheduled</div>
          <div className="ds-channel__factvalue">{next}</div>
        </div>
      </div>

      {children}

      <div className="ds-channel__actions">{actions}</div>
      {footer}
    </Card>
  );
}

/** The dry-run panel every channel offers: a textarea, a run button and the
 *  standing reassurance that nothing is staged and no watermark moves. */
export function SamplePanel({ value, onChange, placeholder, rows = 4, action, note }: {
  value: string; onChange: (v: string) => void; placeholder: string; rows?: number;
  action: React.ReactNode; note?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        className="ds-input ds-textarea" rows={rows} value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {action}
        <span className="ds-note">
          {note ?? "Dry run — nothing is staged and the start point does not move."}
        </span>
      </div>
    </div>
  );
}

/** Streamed run output. Shared by the inbox and WhatsApp channels. */
export function RunLog({ lines, innerRef, max = 200 }: {
  lines: string[]; innerRef?: React.Ref<HTMLDivElement>; max?: number;
}) {
  if (lines.length === 0) return null;
  return (
    <div ref={innerRef} className="ds-log" style={{ maxHeight: max }}>
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.startsWith("✗") ? "var(--asb-red-bg)" : l.startsWith("✓") ? "var(--asb-green-bg)" : "inherit" }}>
          {l}
        </div>
      ))}
    </div>
  );
}
