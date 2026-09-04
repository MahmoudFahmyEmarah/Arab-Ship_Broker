"use client";

// Manual Review — two queues:
//   • Commodities — UNMAPPED market names → assign an ASB regime (commodities dict)
//   • Vessels — IMO-less circular positions → sync by a name+built+dwt composite
//     key, or by IMO if the admin supplies one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, X, ArrowRight, Ban, PackageSearch, Ship, Mail, Wrench, ExternalLink, Clipboard } from "lucide-react";
import { ENUMS } from "@/lib/sync/preview";
import { normalizeFlag } from "@/lib/geo/flag-states";
import { isValidImo } from "@/lib/sync/imo";
import { parseEquasisPaste, equasisPasteHasData } from "@/lib/sync/equasis-paste";
import {
  listCommodityQueue, resolveCommodityReview, ignoreCommodityReview, countCommodityQueuePending,
  listVesselQueue, resolveVesselReview, ignoreVesselReview, countVesselQueuePending,
  resolveVesselQueuePatchOnly, findVesselQueueMatches, sendVesselQueueTeaser,
  listInvalidStaged, countInvalidStagedPending, listFlagStates, listOrganizationNames,
  type CommodityQueueRow, type VesselQueueRow, type MatchView, type InvalidStagedRow,
  type FlagStateOpt, type OrganizationOpt,
} from "@/app/(admin)/admin/data-sync/actions";
import { StagedEditDrawer } from "./StagedEditDrawer";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { C, btn } from "./ui";

type Status = "pending" | "mapped" | "ignored";

type Queue = "commodities" | "vessels" | "invalid";

export function ManualReviewView({ onPendingChange }: { onPendingChange?: (n: number) => void }) {
  const [queue, setQueue] = useState<Queue>("commodities");
  const [invalidCount, setInvalidCount] = useState(0);

  const refreshBadge = useCallback(async () => {
    const [cc, vc, ic] = await Promise.all([
      countCommodityQueuePending(), countVesselQueuePending(), countInvalidStagedPending(),
    ]);
    setInvalidCount(ic);
    onPendingChange?.(cc + vc + ic);
  }, [onPendingChange]);
  useEffect(() => { let c = false; (async () => { await Promise.resolve(); if (!c) await refreshBadge(); })(); return () => { c = true; }; }, [refreshBadge]);

  const tabs: { id: Queue; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "commodities", label: "Commodities", icon: <PackageSearch size={15} /> },
    { id: "vessels", label: "Vessels (no IMO)", icon: <Ship size={15} /> },
    { id: "invalid", label: "Needs fixing", icon: <Wrench size={15} />, badge: invalidCount },
  ];

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {tabs.map((t) => {
          const on = t.id === queue;
          return (
            <button key={t.id} onClick={() => setQueue(t.id)}
              style={{ padding: "8px 15px", borderRadius: 8, border: `1px solid ${on ? C.brass : C.line}`,
                background: on ? C.brassBg : "#fff", color: on ? C.brassDeep : C.ink2, cursor: "pointer",
                font: "inherit", fontSize: 13.5, fontWeight: on ? 600 : 500, display: "inline-flex", alignItems: "center", gap: 7 }}>
              {t.icon}
              {t.label}
              {t.badge ? <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: C.redBg, color: C.red, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{t.badge}</span> : null}
            </button>
          );
        })}
      </div>
      {queue === "commodities" ? <CommodityQueue onChange={refreshBadge} />
        : queue === "vessels" ? <VesselQueue onChange={refreshBadge} />
        : <InvalidQueue onChange={refreshBadge} />}
    </div>
  );
}

// ── Invalid staged rows ("Needs fixing"), grouped by category ────────────────
const SHEET_META: Record<string, { label: string }> = {
  cargo: { label: "Cargo" },
  vessels: { label: "Vessels" },
  ports: { label: "Ports" },
  companies: { label: "Companies" },
  commodities: { label: "Commodities" },
};

function InvalidQueue({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<InvalidStagedRow[] | null>(null);
  const [batchLabel, setBatchLabel] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("all");
  const [editing, setEditing] = useState<InvalidStagedRow | null>(null);

  const reload = useCallback(async () => {
    const res = await listInvalidStaged();
    if (!res.success) { toast.error(res.error); setRows([]); return; }
    setRows(res.data.rows);
    setBatchLabel(res.data.batchLabel);
    onChange();
  }, [onChange]);
  useEffect(() => { let c = false; (async () => { await Promise.resolve(); if (!c) await reload(); })(); return () => { c = true; }; }, [reload]);

  // Category chips with per-category counts (only categories that have rows).
  const cats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows ?? []) counts.set(r.sheet, (counts.get(r.sheet) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const shown = (rows ?? []).filter((r) => cat === "all" || r.sheet === cat);

  if (rows === null) return <Loading />;
  if (rows.length === 0)
    return <Empty icon={<Wrench size={26} />} text="No invalid rows in the current review batch — everything either syncs cleanly or has already been fixed." />;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14, alignItems: "center" }}>
        {[["all", `All (${rows.length})`] as const, ...cats.map((c) => [c[0], `${SHEET_META[c[0]]?.label ?? c[0]} (${c[1]})`] as const)].map(([id, label]) => {
          const on = id === cat;
          return (
            <button key={id} onClick={() => setCat(id)}
              style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${on ? C.brass : C.line}`, background: on ? C.brassBg : "#fff", color: on ? C.brassDeep : C.ink2, cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: on ? 600 : 500 }}>
              {label}
            </button>
          );
        })}
        {batchLabel && <span style={{ marginLeft: "auto", fontSize: 12, color: C.ink3, fontFamily: C.mono }}>{batchLabel}</span>}
      </div>

      <div style={listStyle}>
        {shown.map((r, i) => {
          const errs = r.flags.filter((f) => f.level === "error");
          return (
            <div key={r.id} style={rowStyle(i)}>
              <span style={{ ...iconChip, background: C.redBg, color: C.red }}><Wrench size={16} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: C.brassDeep, marginRight: 8 }}>{SHEET_META[r.sheet]?.label ?? r.sheet}</span>
                  {r.business_key ?? (r.row_index != null ? `Row ${r.row_index}` : "—")}
                </div>
                <div style={{ fontSize: 12, color: C.red, marginTop: 2 }}>
                  {errs.map((f) => `${f.field ? `${f.field}: ` : ""}${f.msg}`).join(" · ") || "Invalid row"}
                </div>
              </div>
              <button onClick={() => setEditing(r)} style={btn("primary")}>Fix <ArrowRight size={14} /></button>
            </div>
          );
        })}
      </div>

      {editing && (
        <StagedEditDrawer
          row={editing}
          sheetId={editing.sheet}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); }}
        />
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}

// ── Commodities queue ────────────────────────────────────────────────────────
function CommodityQueue({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<Status>("pending");
  const [rows, setRows] = useState<CommodityQueueRow[] | null>(null);
  const [resolving, setResolving] = useState<CommodityQueueRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listCommodityQueue(status);
    if (!res.success) { toast.error(res.error); setRows([]); return; }
    setRows(res.data);
    onChange();
  }, [status, onChange]);
  useEffect(() => { let c = false; (async () => { await Promise.resolve(); if (!c) await reload(); })(); return () => { c = true; }; }, [reload]);

  const ignore = async (r: CommodityQueueRow) => {
    setBusy(r.id);
    const res = await ignoreCommodityReview(r.id);
    setBusy(null);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`"${r.raw_name}" moved out of the queue.`);
    await reload();
  };

  return (
    <>
      <StatusFilter status={status} setStatus={setStatus as (s: string) => void} mapped="mapped" />
      {rows === null ? <Loading /> : rows.length === 0 ? (
        <Empty icon={<PackageSearch size={26} />} text={status === "pending" ? "Nothing to review — every commodity resolved to a known regime." : `No ${status} commodities.`} />
      ) : (
        <div style={listStyle}>
          {rows.map((r, i) => (
            <div key={r.id} style={rowStyle(i)}>
              <span style={iconChip}><PackageSearch size={17} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>{r.raw_name}</div>
                <div style={{ fontSize: 12, color: C.ink3, fontFamily: C.mono }}>
                  {r.source}{r.sample_ref ? ` · seen on ${r.sample_ref}` : ""} · {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
              {status === "pending" ? (
                <>
                  <button onClick={() => ignore(r)} disabled={busy === r.id} style={btn("ghost")}>
                    {busy === r.id ? <Loader2 size={14} style={spin} /> : <Ban size={14} />} Ignore
                  </button>
                  <button onClick={() => setResolving(r)} style={btn("primary")}>Assign regime <ArrowRight size={14} /></button>
                </>
              ) : <StatusPill status={r.status} good="mapped" />}
            </div>
          ))}
        </div>
      )}
      {resolving && <CommodityModal row={resolving} onClose={() => setResolving(null)} onDone={async () => { setResolving(null); await reload(); }} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}

// ── Vessels queue ────────────────────────────────────────────────────────────
type VStatus = "pending" | "synced" | "ignored";
function VesselQueue({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<VStatus>("pending");
  const [rows, setRows] = useState<VesselQueueRow[] | null>(null);
  const [resolving, setResolving] = useState<VesselQueueRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listVesselQueue(status);
    if (!res.success) { toast.error(res.error); setRows([]); return; }
    setRows(res.data);
    onChange();
  }, [status, onChange]);
  useEffect(() => { let c = false; (async () => { await Promise.resolve(); if (!c) await reload(); })(); return () => { c = true; }; }, [reload]);

  const ignore = async (r: VesselQueueRow) => {
    setBusy(r.id);
    const res = await ignoreVesselReview(r.id);
    setBusy(null);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`"${r.vessel_name}" moved out of the queue.`);
    await reload();
  };

  return (
    <>
      <StatusFilter status={status} setStatus={setStatus as (s: string) => void} mapped="synced" />
      {rows === null ? <Loading /> : rows.length === 0 ? (
        <Empty icon={<Ship size={26} />} text={status === "pending" ? "No vessels awaiting review." : `No ${status} vessels.`} />
      ) : (
        <div style={listStyle}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ ...rowStyle(i), cursor: status === "pending" ? "pointer" : "default" }}
              onClick={() => status === "pending" && setResolving(r)}
              title={status === "pending" ? "Open to review, edit, match and sync" : undefined}>
              <span style={iconChip}><Ship size={17} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>{r.vessel_name}</div>
                <div style={{ fontSize: 12, color: C.ink3, fontFamily: C.mono }}>
                  {r.dwt_grain ? `${r.dwt_grain.toLocaleString()} dwt` : "dwt —"}
                  {r.grt ? ` · ${r.grt.toLocaleString()} grt` : ""}
                  {r.open_port || r.open_country ? ` · open ${[r.open_port, r.open_country].filter(Boolean).join(", ")}${r.open_zone ? ` (${r.open_zone})` : ""}` : r.open_zone ? ` · open ${r.open_zone}` : ""}
                  {r.open_date ? ` · from ${r.open_date}` : ""}
                  {r.direction ? ` · → ${r.direction}` : ""}
                  {r.built ? ` · built ${r.built}` : ""}
                  {r.commercial_manager ? ` · mgr ${r.commercial_manager}` : ""}
                  {r.imo_hint ? ` · IMO ${r.imo_hint} (workbook)` : " · no IMO"}
                </div>
              </div>
              {status === "pending" ? (
                <>
                  <button onClick={(e) => { e.stopPropagation(); ignore(r); }} disabled={busy === r.id} style={btn("ghost")}>
                    {busy === r.id ? <Loader2 size={14} style={spin} /> : <Ban size={14} />} Ignore
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setResolving(r); }} style={btn("primary")}>Review &amp; edit <ArrowRight size={14} /></button>
                </>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {r.status === "synced" && r.resolved_with_imo === false && (
                    <span title="Synced by name + built + DWT — add the IMO when known" style={{ fontSize: 10, fontWeight: 700, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 3, padding: "1px 5px" }}>IMO PENDING</span>
                  )}
                  <StatusPill status={r.status} good="synced" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {resolving && <VesselModal row={resolving} onClose={() => setResolving(null)} onDone={async () => { setResolving(null); await reload(); }} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}

// ── vessel resolve modal — editable extraction, matches, reply, sync ────────
function VesselModal({ row, onClose, onDone }: { row: VesselQueueRow; onClose: () => void; onDone: () => void }) {
  // A reference source (unified workbook) may already know the IMO — pre-fill
  // it so the admin only has to confirm.
  const [imo, setImo] = useState(row.imo_hint ?? "");
  const [name, setName] = useState(row.vessel_name);
  const [vtype, setVtype] = useState(row.vessel_type ?? "Bulk Carrier");
  const [dwt, setDwt] = useState(row.dwt_grain != null ? String(row.dwt_grain) : "");
  const [grt, setGrt] = useState(row.grt != null ? String(row.grt) : "");
  const [nrt, setNrt] = useState(row.nrt != null ? String(row.nrt) : "");
  const [built, setBuilt] = useState(row.built != null ? String(row.built) : "");
  // flag is a closed vocabulary (flag_states) — normalise what the circular said
  const [flag, setFlag] = useState(normalizeFlag(row.flag) ?? row.flag ?? "");
  const [openPort, setOpenPort] = useState(row.open_port ?? "");
  const [openDate, setOpenDate] = useState(row.open_date ?? "");
  const [openZone, setOpenZone] = useState(row.open_zone ?? "");
  const [direction, setDirection] = useState(row.direction ?? "");
  // company roles (Equasis wording) — linked into the company registry on sync
  const [ownerCompany, setOwnerCompany] = useState(row.owner_company ?? "");
  const [commercialManager, setCommercialManager] = useState(row.commercial_manager ?? "");
  const [ismManager, setIsmManager] = useState(row.ism_manager ?? "");
  const [flagOptions, setFlagOptions] = useState<FlagStateOpt[]>([]);
  const [orgOptions, setOrgOptions] = useState<OrganizationOpt[]>([]);
  useEffect(() => {
    let c = false;
    (async () => {
      const [f, o] = await Promise.all([listFlagStates(), listOrganizationNames()]);
      if (c) return;
      if (f.success) setFlagOptions(f.data); else toast.error(f.error);
      if (o.success) setOrgOptions(o.data);
    })();
    return () => { c = true; };
  }, []);
  // Equasis: manual lookup + paste (their conditions forbid automated fetching)
  const [equasisOpen, setEquasisOpen] = useState(false);
  const [equasisText, setEquasisText] = useState("");
  const imoTrim = imo.trim();
  const imoOk = isValidImo(imoTrim);
  const flagKnown = !flag || flagOptions.length === 0 || flagOptions.some((f) => f.name === flag);
  // Platform-standard port entry: suggest curated ports (name · locode)
  const [portOptions, setPortOptions] = useState<{ name: string; locode: string }[]>([]);
  useEffect(() => {
    let c = false;
    (async () => {
      // Same client-side read the portal's port autocomplete relies on
      // (ports are verified-readable for every signed-in user).
      const { data, error } = await getSupabaseBrowserClient()
        .from("ports")
        .select("trade_name, locode")
        .eq("is_active", true)
        .order("trade_name")
        .limit(1000);
      if (c) return;
      if (error) { console.error("[manual-review] port options:", error.message); return; }
      setPortOptions((data ?? []).map((p) => ({ name: p.trade_name as string, locode: p.locode as string })));
    })();
    return () => { c = true; };
  }, []);
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<MatchView[] | null | "loading">(null);
  const [sendingTeaser, setSendingTeaser] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const src = row.source_email;
  const isWaContact = !!src?.from && !src.from.startsWith("simulated") &&
    (src.channel === "whatsapp" || /@(s\.whatsapp\.net|lid)$/.test(src.from ?? ""));

  const patch = () => ({
    vessel_name: name,
    vessel_type: vtype || null,
    dwt_grain: dwt.trim() ? Number.parseInt(dwt.replace(/[,\s]/g, ""), 10) || null : null,
    grt: grt.trim() ? Number.parseInt(grt.replace(/[,\s]/g, ""), 10) || null : null,
    nrt: nrt.trim() ? Number.parseInt(nrt.replace(/[,\s]/g, ""), 10) || null : null,
    built: built.trim() ? Number.parseInt(built, 10) || null : null,
    flag: flag.trim() || null,
    open_port: openPort.trim() || null,
    open_date: openDate.trim() || null,
    open_zone: openZone || null,
    direction: direction.trim() || null,
    owner_company: ownerCompany.trim() || null,
    commercial_manager: commercialManager.trim() || null,
    ism_manager: ismManager.trim() || null,
  });

  // Sync = write the vessel to the register AND post her OPEN position to the
  // market (dashboard / Vessels board / Insights). The IMO is mandatory; the
  // "temporary" path needs an explicit confirmation and leaves an IMO PENDING
  // marker on the queue row.
  const sync = async (allowWithoutImo = false) => {
    if (allowWithoutImo && !confirm(
      "Sync without an IMO number?\n\nThis is temporary: the vessel joins the register by name + built + DWT and stays marked \u201cIMO pending\u201d until you add it.")) return;
    setSaving(true);
    const res = await resolveVesselReview(row.id, imoTrim || null, patch(), { allowWithoutImo });
    setSaving(false);
    if (!res.success) { toast.error(res.error); return; }
    const msg = res.data.op === "imo" ? "Synced with IMO — open position is live on the market."
      : res.data.op === "composite-update" ? "Matched an existing vessel — updated, position live."
      : "Synced (IMO pending) — position live.";
    toast.success(res.data.portResolved || !openPort.trim() ? msg : `${msg} Open port kept as text (no port-registry match).`);
    onDone();
  };

  const applyEquasis = () => {
    const p = parseEquasisPaste(equasisText);
    if (!equasisPasteHasData(p)) { toast.error("Nothing recognisable in the pasted text — copy the Ship info and Management detail tables."); return; }
    if (p.imo) setImo(p.imo);
    if (p.name) setName(p.name);
    if (p.flag) setFlag(p.flag);
    if (p.grt) setGrt(String(p.grt));
    if (p.dwt && !dwt.trim()) setDwt(String(p.dwt));
    if (p.built) setBuilt(String(p.built));
    if (p.vesselType) setVtype(p.vesselType);
    if (p.registeredOwner) setOwnerCompany(p.registeredOwner);
    if (p.commercialManager) setCommercialManager(p.commercialManager);
    if (p.ismManager) setIsmManager(p.ismManager);
    const n = Object.values(p).filter((v) => v !== undefined && v !== "").length;
    toast.success(`Filled ${n} field${n === 1 ? "" : "s"} from Equasis — review, then sync.`);
    setEquasisOpen(false);
  };

  // Save corrections WITHOUT syncing — the record stays pending in the queue.
  const [savingOnly, setSavingOnly] = useState(false);
  const saveOnly = async () => {
    setSavingOnly(true);
    const res = await resolveVesselQueuePatchOnly(row.id, patch());
    setSavingOnly(false);
    if (!res.success) { toast.error(res.error); return; }
    toast.success("Changes saved — the record stays in the queue.");
    onDone();
  };

  const runMatches = async () => {
    // persist edits first so the match uses what the admin sees
    const saved = await resolveVesselQueuePatchOnly(row.id, patch());
    if (!saved.success) { toast.error(saved.error); return; }
    setMatches("loading");
    const r = await findVesselQueueMatches(row.id);
    if (!r.success) { toast.error(r.error); setMatches(null); return; }
    setMatches(r.data);
  };

  const sendTeaser = async () => {
    if (!confirm("Send the masked match summary to this WhatsApp contact?")) return;
    setSendingTeaser(true);
    const r = await sendVesselQueueTeaser(row.id);
    setSendingTeaser(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(r.data.status === "queued" ? "Summary queued — sending in seconds." : "Summary sent.");
  };

  const bandColor = (b: string) => (b === "Strong" ? C.green : b === "Good" ? C.amber : C.ink3);
  const field: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`, font: "inherit", fontSize: 13.5, background: "#fff", color: C.ink };
  const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.ink2, marginBottom: 5, display: "block" };

  return (
    <ModalShell innerRef={ref} onClose={onClose} title={row.vessel_name} subtitle="Review, correct and sync this open-position vessel">
      {/* editable extraction */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}><label style={lab}>Vessel name</label><input value={name} onChange={(e) => setName(e.target.value)} style={field} /></div>
        <div>
          <label style={lab}>Type</label>
          <select value={vtype} onChange={(e) => setVtype(e.target.value)} style={field}>
            {["Bulk Carrier", "Cargo Ship", "General Cargo", "Other"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div><label style={lab}>DWT</label><input value={dwt} onChange={(e) => setDwt(e.target.value)} placeholder="e.g. 17000" style={field} /></div>
        <div>
          <label style={lab}>GRT <span style={{ color: C.ink3, fontWeight: 400 }}>(gross — key for port costs)</span></label>
          <input value={grt} onChange={(e) => setGrt(e.target.value)} placeholder="gross tonnage" style={field} />
        </div>
        <div>
          <label style={lab}>NRT <span style={{ color: C.ink3, fontWeight: 400 }}>(net)</span></label>
          <input value={nrt} onChange={(e) => setNrt(e.target.value)} placeholder="net tonnage" style={field} />
        </div>
        <div><label style={lab}>Built</label><input value={built} onChange={(e) => setBuilt(e.target.value)} placeholder="year" style={field} /></div>
        <div>
          <label style={lab}>
            Flag <span style={{ color: C.ink3, fontWeight: 400 }}>(ship register)</span>
            {!flagKnown && <span style={{ color: C.red, fontWeight: 600 }}> · \u201c{flag}\u201d is not a known register — pick one</span>}
          </label>
          <select value={flag} onChange={(e) => setFlag(e.target.value)} style={{ ...field, borderColor: flagKnown ? C.line : C.red }}>
            <option value="">—</option>
            {!flagKnown && <option value={flag}>{flag} (unrecognised)</option>}
            <optgroup label="Open registries">
              {flagOptions.filter((f) => f.category === "open").map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </optgroup>
            <optgroup label="National registers">
              {flagOptions.filter((f) => f.category === "national").map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </optgroup>
            {flagOptions.filter((f) => f.category === "unknown").map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lab}>Open port {row.open_country && <span style={{ color: C.ink3, fontWeight: 400 }}>({row.open_country})</span>}</label>
          <input value={openPort} onChange={(e) => setOpenPort(e.target.value)} placeholder="e.g. Mostaganem" style={field} list="dsq-ports" />
          <datalist id="dsq-ports">
            {portOptions.map((p) => <option key={p.locode} value={p.name}>{p.locode}</option>)}
          </datalist>
        </div>
        <div>
          <label style={lab}>Open date <span style={{ color: C.ink3, fontWeight: 400 }}>(availability — key match factor)</span></label>
          <input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} style={field} />
        </div>
        <div>
          <label style={lab}>Open zone</label>
          <select value={openZone} onChange={(e) => setOpenZone(e.target.value)} style={field}>
            <option value="">—</option>
            {ENUMS.zone.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lab}>Direction {row.dest_zones?.length ? <span style={{ color: C.ink3, fontWeight: 400 }}>(zones: {row.dest_zones.join(" / ")})</span> : null}</label>
          <input value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="e.g. Black Sea or Turkey" style={field} />
        </div>
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, paddingTop: 6, borderTop: `1px dashed ${C.line}` }}>
          <div>
            <label style={lab}>Registered owner</label>
            <input value={ownerCompany} onChange={(e) => setOwnerCompany(e.target.value)} placeholder="company name" style={field} list="dsq-orgs" />
          </div>
          <div>
            <label style={lab}>Commercial / ship manager <span style={{ color: C.brassDeep, fontWeight: 600 }}>(key counterparty)</span></label>
            <input value={commercialManager} onChange={(e) => setCommercialManager(e.target.value)} placeholder="who fixes her" style={{ ...field, borderColor: C.brass }} list="dsq-orgs" />
          </div>
          <div>
            <label style={lab}>ISM manager</label>
            <input value={ismManager} onChange={(e) => setIsmManager(e.target.value)} placeholder="DOC holder" style={field} list="dsq-orgs" />
          </div>
          <datalist id="dsq-orgs">
            {orgOptions.map((o) => <option key={o.name} value={o.name}>{o.org_type ?? ""}</option>)}
          </datalist>
          <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: C.ink3, marginTop: -4 }}>
            Names are matched to the company registry on sync (created there when new). The commercial manager is what matters for chartering.
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lab}>
            IMO number <span style={{ color: C.ink3, fontWeight: 400 }}>(required — 7 digits with a valid check digit)</span>
            {row.imo_hint && <span style={{ color: C.brassDeep, fontWeight: 600 }}> · pre-filled from the unified workbook — please confirm</span>}
            {imoTrim && !imoOk && <span style={{ color: C.red, fontWeight: 600 }}> · not a valid IMO</span>}
            {imoOk && <span style={{ color: C.green, fontWeight: 600 }}> · check digit OK</span>}
          </label>
          <input value={imo} onChange={(e) => setImo(e.target.value.replace(/[^\d]/g, "").slice(0, 7))} inputMode="numeric" placeholder="e.g. 9365702 — look her up on Equasis if the circular has none"
            style={{ ...field, fontFamily: C.mono, borderColor: !imoTrim ? C.line : imoOk ? C.green : C.red }} />
        </div>
      </div>
      {row.posted_at && (
        <div style={{ fontSize: 11.5, color: C.ink3, marginTop: 8 }}>Position posted {new Date(row.posted_at).toLocaleString()}</div>
      )}

      {/* Equasis — manual lookup + paste. Their conditions of use forbid
          web-robots / automated retrieval, so the platform never fetches. */}
      <div style={{ marginTop: 14, padding: "10px 12px", border: `1px dashed ${C.line}`, borderRadius: 8, background: C.sunken }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: C.ink3 }}>EQUASIS</span>
          {/* Equasis' ship search is a login-protected form (no public deep
              link that carries the query), so we open the Search page itself
              and put the best search key on the clipboard: the IMO when we
              have one, else the vessel name. The browser's own password
              manager handles the login — the platform never stores it. */}
          <a href="https://www.equasis.org/EquasisWeb/restricted/Search?fs=HomePage" target="_blank" rel="noreferrer"
            onClick={() => {
              const key = imoOk ? imoTrim : name.trim().replace(/^unnamed vessel.*$/i, "").trim();
              if (!key) return;
              navigator.clipboard?.writeText(key)
                .then(() => toast.success(`Copied “${key}” — paste it into the Equasis ship search box.`))
                .catch(() => {});
            }}
            title={imoOk ? `Opens the Equasis ship search with IMO ${imoTrim} on your clipboard` : name.trim() ? `Opens the Equasis ship search with “${name.trim()}” on your clipboard` : "Opens the Equasis ship search"}
            style={{ ...btn("ghost"), padding: "5px 10px", fontSize: 12, textDecoration: "none" }}>
            <ExternalLink size={13} /> Open Equasis search{imoOk ? " (IMO copied)" : name.trim() && !/^unnamed vessel/i.test(name) ? " (name copied)" : ""}
          </a>
          <button onClick={() => setEquasisOpen((o) => !o)} style={{ ...btn("ghost"), padding: "5px 10px", fontSize: 12 }}>
            <Clipboard size={13} /> {equasisOpen ? "Hide paste box" : "Paste ship particulars"}
          </button>
          <span style={{ fontSize: 11.5, color: C.ink3 }}>
            Sign in (your browser can remember it), paste the search key, open the ship, copy the <b>Ship info</b> and <b>Management detail</b> tables, paste — the fields above fill in for your review.
          </span>
        </div>
        {equasisOpen && (
          <>
            <textarea value={equasisText} onChange={(e) => setEquasisText(e.target.value)}
              placeholder={"IMO number : 9365702\nName of ship : DORIS\nGross tonnage : 2999\nType of ship : General Cargo Ship\nYear of build : 2006\nFlag : Barbados\nRegistered owner   SOME OWNER LTD\nShip manager/Commercial manager   SOME MANAGER CO\nISM Manager   SOME MANAGER CO"}
              style={{ ...field, marginTop: 8, minHeight: 120, fontFamily: C.mono, fontSize: 12, resize: "vertical" }} />
            <div style={{ marginTop: 8 }}>
              <button onClick={applyEquasis} disabled={!equasisText.trim()} style={{ ...btn("dark"), padding: "6px 12px", fontSize: 12.5, opacity: equasisText.trim() ? 1 : 0.5 }}>
                <Check size={13} /> Fill fields from paste
              </button>
            </div>
          </>
        )}
      </div>

      {/* matches — usable even on incomplete records (needs at least a DWT) */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: C.ink3 }}>MATCHING CARGOES</span>
          <button onClick={runMatches} disabled={matches === "loading"} style={{ ...btn("ghost"), padding: "5px 10px", fontSize: 12 }}>
            {matches === "loading" ? <Loader2 size={13} style={spin} /> : <ArrowRight size={13} />}
            {matches === null ? "Find matches" : "Refresh"}
          </button>
          {isWaContact && Array.isArray(matches) && (
            <button onClick={sendTeaser} disabled={sendingTeaser} style={{ ...btn("primary"), padding: "5px 10px", fontSize: 12, marginLeft: "auto" }}>
              {sendingTeaser ? <Loader2 size={13} style={spin} /> : <Mail size={13} />} Reply with summary
            </button>
          )}
        </div>
        {Array.isArray(matches) && (matches.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.ink3 }}>No matching cargoes in the live database or staged drafts.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {matches.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 10px" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: bandColor(m.band), border: `1px solid ${bandColor(m.band)}`, borderRadius: 3, padding: "1px 5px" }}>{m.band.toUpperCase()}</span>
                <span style={{ fontWeight: 600, color: C.navy }}>{m.label}</span>
                <span style={{ color: C.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.facts.join(" · ")}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: m.origin === "live" ? C.green : C.brassDeep, background: m.origin === "live" ? C.greenBg : C.brassBg, padding: "1px 6px", borderRadius: 3 }}>{m.origin.toUpperCase()}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {src && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: C.ink3, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <Mail size={12} /> {src.channel === "whatsapp" ? "SOURCE WHATSAPP MESSAGE" : "SOURCE EMAIL"}
          </div>
          <div style={{ fontSize: 12.5, color: C.navy, fontWeight: 600 }}>
            {src.channel === "whatsapp"
              ? `${src.name ?? "Unknown contact"} · ${(src.from ?? "").replace("@s.whatsapp.net", "").replace("@lid", "")}`
              : (src.subject || "(no subject)")}
          </div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: C.mono, fontSize: 12, color: C.ink2, margin: "6px 0 0", maxHeight: 160, overflowY: "auto", background: C.sunken, padding: "10px 12px", borderRadius: 8 }}>{src.text || "(no body)"}</pre>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        <button onClick={saveOnly} disabled={savingOnly || saving || !name.trim()} style={{ ...btn("dark"), opacity: savingOnly || !name.trim() ? 0.5 : 1 }}>
          {savingOnly ? <Loader2 size={15} style={spin} /> : <Check size={15} />} Save changes
        </button>
        <button onClick={() => sync(false)} disabled={saving || savingOnly || !name.trim() || !imoOk}
          title={!imoOk ? "Enter a valid 7-digit IMO number to sync" : "Write to the register and post her open position"}
          style={{ ...btn("primary"), opacity: saving || !name.trim() || !imoOk ? 0.5 : 1 }}>
          {saving ? <Loader2 size={15} style={spin} /> : <Check size={15} />} Sync with IMO
        </button>
        {!imoTrim && (
          <button onClick={() => sync(true)} disabled={saving || savingOnly || !name.trim()}
            title="Temporary — the vessel is matched by name + built + DWT and stays flagged IMO PENDING"
            style={{ ...btn("ghost"), fontSize: 12.5, opacity: saving || !name.trim() ? 0.5 : 1 }}>
            Sync without IMO (temporary)
          </button>
        )}
        <button onClick={onClose} style={{ ...btn("ghost"), marginLeft: "auto" }}>Cancel</button>
      </div>
      <div style={{ fontSize: 11.5, color: C.ink3, marginTop: 8 }}>
        <b>Save changes</b> keeps your corrections on this queue record only. <b>Sync</b> writes the vessel to the register, links the companies, and posts her OPEN position live on the dashboard and Vessels board.
      </div>
    </ModalShell>
  );
}

// ── commodity resolve modal ──────────────────────────────────────────────────
function CommodityModal({ row, onClose, onDone }: { row: CommodityQueueRow; onClose: () => void; onDone: () => void }) {
  const [canonical, setCanonical] = useState(row.raw_name);
  const [category, setCategory] = useState("");
  const [cargoType, setCargoType] = useState<string>(ENUMS.cargoType[0]);
  const [imsbc, setImsbc] = useState<string>("Non_DG");
  const [isGrain, setIsGrain] = useState(false);
  const [isDg, setIsDg] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const changeImsbc = (v: string) => { setImsbc(v); if (v === "DG") setIsDg(true); };

  const submit = async () => {
    setSaving(true);
    const res = await resolveCommodityReview(row.id, { canonical, cargoType, imsbc, category: category || null, isGrain, isDg, notes: notes || null });
    setSaving(false);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`"${canonical}" added to the commodity dictionary.`);
    onDone();
  };

  const field: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`, font: "inherit", fontSize: 13.5, color: C.ink, background: "#fff" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.ink2, marginBottom: 5, display: "block" };
  return (
    <ModalShell innerRef={ref} onClose={onClose} title="Assign regime" subtitle="Creates or updates a row in the commodity dictionary.">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div><label style={label}>Canonical name</label><input value={canonical} onChange={(e) => setCanonical(e.target.value)} style={field} /></div>
        <div><label style={label}>Category label <span style={{ color: C.ink3, fontWeight: 400 }}>(optional)</span></label><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Grains, Fertilisers" style={field} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          <div><label style={label}>Cargo type</label><select value={cargoType} onChange={(e) => setCargoType(e.target.value)} style={field}>{ENUMS.cargoType.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
          <div><label style={label}>IMSBC category</label><select value={imsbc} onChange={(e) => changeImsbc(e.target.value)} style={field}>{ENUMS.imsbc.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink2, cursor: "pointer" }}><input type="checkbox" checked={isGrain} onChange={(e) => setIsGrain(e.target.checked)} /> Grain regime</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink2, cursor: "pointer" }}><input type="checkbox" checked={isDg} onChange={(e) => setIsDg(e.target.checked)} /> Dangerous goods</label>
        </div>
        <div><label style={label}>Notes <span style={{ color: C.ink3, fontWeight: 400 }}>(optional)</span></label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...field, resize: "vertical" }} /></div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button onClick={submit} disabled={saving || !canonical.trim()} style={{ ...btn("primary"), opacity: saving || !canonical.trim() ? 0.5 : 1 }}>
          {saving ? <Loader2 size={15} style={spin} /> : <Check size={15} />} Resolve &amp; add
        </button>
        <button onClick={onClose} style={btn("ghost")}>Cancel</button>
      </div>
    </ModalShell>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────
const spin: React.CSSProperties = { animation: "spin 1s linear infinite" };
const listStyle: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", background: "#fff" };
const iconChip: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, background: C.brassBg, color: C.brassDeep, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
const rowStyle = (i: number): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderTop: i ? `1px solid ${C.line}` : "none" });

function StatusFilter({ status, setStatus, mapped }: { status: string; setStatus: (s: string) => void; mapped: string }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
      {["pending", mapped, "ignored"].map((s) => {
        const on = s === status;
        return (
          <button key={s} onClick={() => setStatus(s)}
            style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${on ? C.brass : C.line}`, background: on ? C.brassBg : "#fff", color: on ? C.brassDeep : C.ink2, cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: on ? 600 : 500, textTransform: "capitalize" }}>
            {s}
          </button>
        );
      })}
    </div>
  );
}

function StatusPill({ status, good }: { status: string; good: string }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: status === good ? C.green : C.ink3 }}>{status}</span>;
}

function Loading() { return <div style={{ padding: 40, textAlign: "center", color: C.ink3 }}><Loader2 size={20} style={spin} /></div>; }
function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div style={{ padding: "40px 20px", textAlign: "center", color: C.ink3, fontSize: 14, border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff" }}><div style={{ opacity: 0.5, marginBottom: 8 }}>{icon}</div>{text}</div>;
}

function ModalShell({ innerRef, title, subtitle, onClose, children }: { innerRef: React.RefObject<HTMLDivElement | null>; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div ref={innerRef} onMouseDown={(e) => { if (e.target === innerRef.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(10,26,47,.34)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "min(520px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 22px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.navy }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: C.ink3, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.ink2, padding: 4 }} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ padding: "20px 22px" }}>{children}</div>
      </div>
    </div>
  );
}
