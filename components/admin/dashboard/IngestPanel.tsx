"use client";

// Ingestion & data quality — recent sync batches, staging quality rates, the
// Manual Review backlog and other data-quality counters, review throughput
// and the active LLM credential.
import * as React from "react";
import Link from "next/link";
import type { DashboardFeed, RangeKey } from "@/lib/admin/dashboard/types";
import { RANGE_LABEL, fmtInt, fmtWhen, pct } from "@/lib/admin/dashboard/model";
import { Box, Dot, Fresh, Panel, StatePill } from "./ui";
import type { Level } from "@/lib/admin/dashboard/types";

function sourceLabel(b: DashboardFeed["ingest"]["batches"][number]): string {
  if (b.source === "email") return `Email · ${b.file_name?.replace(/^inbox:/, "") ?? "inbox"}`;
  if (b.source === "whatsapp") return "WhatsApp · circulars";
  return `Workbook · ${b.file_name ?? b.label ?? "upload"}`;
}

export function IngestPanel({ feed, range, stale, freshText }: { feed: DashboardFeed; range: RangeKey; stale: boolean; freshText: string }) {
  const g = feed.ingest;
  const llm = feed.llm;
  const dq: { label: string; n: number; level: Level }[] = [
    { label: "Commodities to map", n: g.crq_pending, level: g.crq_pending ? "warn" : "ok" },
    { label: "Vessels without IMO", n: g.vrq_pending, level: g.vrq_pending ? "warn" : "ok" },
    { label: "Live cargo not resolved to a LOCODE", n: g.unresolved_ports, level: g.unresolved_ports ? "warn" : "ok" },
    { label: "Positions without a port or zone", n: g.blank_positions, level: g.blank_positions ? "crit" : "ok" },
    { label: "Unknown flags", n: g.flag_issues, level: "info" },
  ];

  return (
    <Panel
      label="Ingestion and data quality"
      title="Ingestion & data quality"
      sub="Every sync batch, its classification quality, and what still needs cleaning."
      stale={stale}
      right={<>
        <Fresh text={`sync_batch · ${freshText}`} level={stale ? "warn" : "ok"} />
        <Link href="/admin/data-sync" className="adb-link">Data Sync →</Link>
      </>}
    >
      <div className="adb-split">
        <div className="adb-table">
          <div className="adb-table__inner">
            <div className="adb-table__head adb-batch">
              <span>When</span><span>Source</span><span className="r">New</span><span className="r">Upd</span><span className="r">Inv</span><span className="r">Err</span><span />
            </div>
            {g.batches.length === 0 && <div className="adb-empty">No sync batches yet.</div>}
            {g.batches.map((b) => {
              const level: Level = b.status === "undone" || b.has_error ? "crit" : b.status === "draft" ? "warn" : b.errors > 0 ? "warn" : "ok";
              return (
                <Link key={b.id} href="/admin/data-sync" className="adb-table__row adb-batch">
                  <span className="adb-muted">{fmtWhen(b.created_at)}</span>
                  <span className="adb-batch__src"><Dot level={level} size={6} /><span className="adb-ellipsis">{sourceLabel(b)}</span></span>
                  <span className="r is-ok">{fmtInt(b.new)}</span>
                  <span className="r">{fmtInt(b.updated)}</span>
                  <span className={`r${b.invalid > 5 ? " is-warn" : ""}`}>{fmtInt(b.invalid)}</span>
                  <span className={`r${b.errors ? " is-crit" : ""}`}>{fmtInt(b.errors)}</span>
                  <span className="adb-batch__st"><StatePill level={level} text={b.status} /></span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="adb-stack">
          <div className="adb-cols2">
            <Box>
              <div className="adb-box__title">Invalid rate</div>
              <div className="adb-big">{g.staged_total ? `${(100 * g.staged_invalid / g.staged_total).toFixed(1)}%` : "—"}</div>
              <div className="adb-note">{fmtInt(g.staged_invalid)} of {fmtInt(g.staged_total)} staged rows</div>
            </Box>
            <Box>
              <div className="adb-box__title">Unchanged rate</div>
              <div className="adb-big">{g.staged_total ? `${(100 * g.staged_unchanged / g.staged_total).toFixed(1)}%` : "—"}</div>
              <div className="adb-note">already in the database · {fmtInt(g.staged_new)} new · {fmtInt(g.staged_updated)} updated</div>
            </Box>
          </div>
          <Box title="Data-quality counters">
            <div className="adb-kv-list">
              {dq.map((d) => (
                <Link key={d.label} href={d.label.startsWith("Positions") ? "/admin/vessel-availability" : d.label.startsWith("Live cargo") ? "/admin/cargo" : d.label.startsWith("Unknown") ? "/admin/vessels" : "/admin/data-sync"} className="adb-kv">
                  <span>{d.label}</span><b className={`is-${d.level}`}>{fmtInt(d.n)}</b>
                </Link>
              ))}
            </div>
          </Box>
          <Box className="adb-throughput">
            <div className="adb-throughput__row">
              <div className="adb-box__title">Review throughput</div>
              <div className="adb-note adb-note--ink">
                Commodities <b>{fmtInt(g.crq_resolved_range)}</b> mapped · Vessels <b>{fmtInt(g.vrq_resolved_range)}</b> resolved, last {RANGE_LABEL[range]} · {pct(g.vrq_synced, g.vrq_synced + g.vrq_ignored + g.vrq_pending)}% of vessels synced
              </div>
            </div>
            <div className="adb-throughput__row">
              <div className="adb-box__title">LLM credential</div>
              <div className="adb-note adb-note--ink">
                {llm ? <><b>{llm.vendor}</b> · {llm.model}</> : <b className="is-crit">no active key</b>}
                <span className="adb-muted"> · spend not reported by the pipeline</span>
              </div>
            </div>
          </Box>
        </div>
      </div>
    </Panel>
  );
}
