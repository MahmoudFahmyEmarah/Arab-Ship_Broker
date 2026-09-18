"use client";

// Intake → Workbook upload. The CargoMap .xlsx drop zone, wearing the same
// channel-card shell as the inbox and WhatsApp sources. All parsing/diffing
// still happens server-side via POST /api/upload/cargomap; this card owns only
// the drag state and hands the file to its parent.

import { useState } from "react";
import { FileSpreadsheet, Upload, AlertTriangle } from "lucide-react";
import { ChannelCard } from "./ChannelCard";
import { Btn, C } from "./ui";

export function UploadCard({ state, error, onPick, onDrop, lastRun }: {
  state: "idle" | "parsing" | "error";
  error: string | null;
  onPick: () => void;
  onDrop: (f: File) => void;
  /** Formatted summary of the most recent workbook batch, or null. */
  lastRun: string | null;
}) {
  const [drag, setDrag] = useState(false);
  const parsing = state === "parsing";

  return (
    <ChannelCard
      abbr="XLSX"
      icon={<FileSpreadsheet size={19} />}
      iconBg="var(--asb-blue-light)"
      iconColor="var(--asb-steel-deep)"
      name="Workbook upload"
      status={parsing ? "Parsing" : "Manual"}
      statusTone={parsing ? "updated" : "neutral"}
      desc="CargoMap .xlsx — drop it here to stage a batch. Max 10 MB."
      last={lastRun ?? "No workbook batch yet"}
      next="On demand"
      actions={
        <Btn kind="primary" icon={<FileSpreadsheet size={15} />} busy={parsing} onClick={onPick}>
          {parsing ? "Parsing & diffing…" : "Choose file"}
        </Btn>
      }
      footer={
        state === "error" && error ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: C.red }}>
            <AlertTriangle size={14} /> {error}
          </div>
        ) : (
          <div className="ds-note">
            Matched by REF / IMO / LOCODE against the live database. Nothing is written until you commit.
          </div>
        )
      }
    >
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDrop(f);
        }}
        onClick={parsing ? undefined : onPick}
        style={{
          border: `2px dashed ${drag ? C.brass : C.line}`,
          borderRadius: "var(--r-soft-10)",
          padding: "20px 16px", textAlign: "center",
          cursor: parsing ? "default" : "pointer",
          background: drag ? C.brassBg : C.sunken,
          transition: "border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease)",
        }}
      >
        <Upload size={20} color={C.brass} style={{ margin: "0 auto 6px", display: "block" }} />
        <div style={{ fontSize: 13, color: C.slate }}>
          {parsing ? "Matching by REF / IMO / LOCODE…" : "Drop the .xlsx here, or click to choose"}
        </div>
      </div>
    </ChannelCard>
  );
}
