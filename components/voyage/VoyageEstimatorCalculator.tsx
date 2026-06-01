"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Fuel } from "lucide-react";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { computeVoyage, type VoyageInputs } from "@/lib/voyage/estimate";

type FuelPrice = {
  vlsfo_usd_mt: number | null;
  lsmgo_usd_mt: number | null;
  port_area: string | null;
  updated_at: string | null;
};

type AvailabilityRow = {
  id: string;
  vessel_id: string | null;
  service_speed_kn: number | null;
  vlsfo_sea_mt_day: number | null;
  vlsfo_port_mt_day: number | null;
  lsmgo_sea_mt_day: number | null;
  lsmgo_port_mt_day: number | null;
  vessel: { vessel_name: string | null; imo_number: string | null; dwt_grain: number | null } | null;
};

type CargoRow = {
  id: string;
  ref: string | null;
  commodity_name: string | null;
  cargo_type: string | null;
  qty_min_mt: number | null;
  qty_max_mt: number | null;
  freight_idea_usd_mt: number | null;
  commission_pct: number | null;
  load_rate: string | null;
  disch_rate: string | null;
  load_port_locode: string | null;
  disch_port_locode: string | null;
};

const num = (s: string) => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const FIELDS: { key: keyof VoyageInputs; label: string; group: string }[] = [
  { key: "ballastNm", label: "Ballast leg (NM)", group: "Voyage" },
  { key: "ladenNm", label: "Laden leg (NM)", group: "Voyage" },
  { key: "speedKn", label: "Service speed (kn)", group: "Voyage" },
  { key: "vlsfoSeaMtDay", label: "VLSFO at sea (MT/day)", group: "Bunkers" },
  { key: "vlsfoPortMtDay", label: "VLSFO in port (MT/day)", group: "Bunkers" },
  { key: "lsmgoSeaMtDay", label: "LSMGO at sea (MT/day)", group: "Bunkers" },
  { key: "lsmgoPortMtDay", label: "LSMGO in port (MT/day)", group: "Bunkers" },
  { key: "vlsfoPrice", label: "VLSFO price ($/MT)", group: "Bunkers" },
  { key: "lsmgoPrice", label: "LSMGO price ($/MT)", group: "Bunkers" },
  { key: "quantityMt", label: "Cargo quantity (MT)", group: "Cargo" },
  { key: "freightUsdMt", label: "Freight ($/MT)", group: "Cargo" },
  { key: "commissionPct", label: "Commission (%)", group: "Cargo" },
  { key: "loadRateMtDay", label: "Load rate (MT/day)", group: "Cargo" },
  { key: "dischRateMtDay", label: "Discharge rate (MT/day)", group: "Cargo" },
  { key: "polDaUsd", label: "Load port DA ($)", group: "Port & Canal" },
  { key: "podDaUsd", label: "Disch port DA ($)", group: "Port & Canal" },
  { key: "suezUsd", label: "Suez Canal toll ($)", group: "Port & Canal" },
];

const emptyInputs: Record<keyof VoyageInputs, string> = {
  ballastNm: "", ladenNm: "", speedKn: "", vlsfoSeaMtDay: "", vlsfoPortMtDay: "",
  lsmgoSeaMtDay: "", lsmgoPortMtDay: "", vlsfoPrice: "", lsmgoPrice: "",
  quantityMt: "", freightUsdMt: "", commissionPct: "", loadRateMtDay: "",
  dischRateMtDay: "", polDaUsd: "", podDaUsd: "", suezUsd: "",
};

export function VoyageEstimatorCalculator() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [vals, setVals] = useState<Record<keyof VoyageInputs, string>>(emptyInputs);
  const [fuel, setFuel] = useState<FuelPrice | null>(null);
  const [availabilities, setAvailabilities] = useState<AvailabilityRow[]>([]);
  const [cargos, setCargos] = useState<CargoRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [selVessel, setSelVessel] = useState("");
  const [selCargo, setSelCargo] = useState("");

  useEffect(() => {
    (async () => {
      const { data: fp } = await supabase
        .from("fuel_prices")
        .select("vlsfo_usd_mt, lsmgo_usd_mt, port_area, updated_at")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fp) {
        setFuel(fp as FuelPrice);
        setVals((v) => ({
          ...v,
          vlsfoPrice: fp.vlsfo_usd_mt != null ? String(fp.vlsfo_usd_mt) : v.vlsfoPrice,
          lsmgoPrice: fp.lsmgo_usd_mt != null ? String(fp.lsmgo_usd_mt) : v.lsmgoPrice,
        }));
      }

      const { data: av } = await supabase
        .from("vessel_availability")
        .select(
          `id, vessel_id, service_speed_kn, vlsfo_sea_mt_day, vlsfo_port_mt_day,
           lsmgo_sea_mt_day, lsmgo_port_mt_day,
           vessel:vessels ( vessel_name, imo_number, dwt_grain )`,
        )
        .eq("review_status", "APPROVED")
        .eq("status", "OPEN")
        .limit(100);
      setAvailabilities((av ?? []) as unknown as AvailabilityRow[]);

      const { data: cg } = await supabase
        .from("cargo_listings")
        .select(
          `id, ref, commodity_name, cargo_type, qty_min_mt, qty_max_mt,
           freight_idea_usd_mt, commission_pct, load_rate, disch_rate,
           load_port_locode, disch_port_locode`,
        )
        .eq("review_status", "APPROVED")
        .in("status", ["IN", "PARTIAL"])
        .limit(100);
      setCargos((cg ?? []) as unknown as CargoRow[]);
    })();
  }, [supabase]);

  function prefillVessel(id: string) {
    setSelVessel(id);
    const a = availabilities.find((x) => x.id === id);
    if (!a) return;
    setVals((v) => ({
      ...v,
      speedKn: a.service_speed_kn != null ? String(a.service_speed_kn) : v.speedKn,
      vlsfoSeaMtDay: a.vlsfo_sea_mt_day != null ? String(a.vlsfo_sea_mt_day) : v.vlsfoSeaMtDay,
      vlsfoPortMtDay: a.vlsfo_port_mt_day != null ? String(a.vlsfo_port_mt_day) : v.vlsfoPortMtDay,
      lsmgoSeaMtDay: a.lsmgo_sea_mt_day != null ? String(a.lsmgo_sea_mt_day) : v.lsmgoSeaMtDay,
      lsmgoPortMtDay: a.lsmgo_port_mt_day != null ? String(a.lsmgo_port_mt_day) : v.lsmgoPortMtDay,
    }));
  }

  function prefillCargo(id: string) {
    setSelCargo(id);
    const c = cargos.find((x) => x.id === id);
    if (!c) return;
    setVals((v) => ({
      ...v,
      quantityMt: c.qty_max_mt != null ? String(c.qty_max_mt) : v.quantityMt,
      freightUsdMt: c.freight_idea_usd_mt != null ? String(c.freight_idea_usd_mt) : v.freightUsdMt,
      commissionPct: c.commission_pct != null ? String(c.commission_pct) : v.commissionPct,
      loadRateMtDay: c.load_rate ? String(num(c.load_rate)) : v.loadRateMtDay,
      dischRateMtDay: c.disch_rate ? String(num(c.disch_rate)) : v.dischRateMtDay,
    }));
  }

  const inputs: VoyageInputs = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(emptyInputs) as (keyof VoyageInputs)[]).map((k) => [k, num(vals[k])]),
      ) as unknown as VoyageInputs,
    [vals],
  );
  const r = useMemo(() => computeVoyage(inputs), [inputs]);

  async function save() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const a = availabilities.find((x) => x.id === selVessel);
      const c = cargos.find((x) => x.id === selCargo);
      const { error } = await supabase.from("voyage_estimates").insert({
        created_by: user.id,
        vessel_id: a?.vessel_id ?? null,
        cargo_id: c?.id ?? null,
        vessel_name: a?.vessel?.vessel_name ?? null,
        cargo_name: c?.commodity_name ?? null,
        pol_locode: c?.load_port_locode ?? null,
        pod_locode: c?.disch_port_locode ?? null,
        ballast_nm: inputs.ballastNm, laden_nm: inputs.ladenNm, service_speed_kn: inputs.speedKn,
        vlsfo_sea_mt_day: inputs.vlsfoSeaMtDay, vlsfo_port_mt_day: inputs.vlsfoPortMtDay,
        lsmgo_sea_mt_day: inputs.lsmgoSeaMtDay, lsmgo_port_mt_day: inputs.lsmgoPortMtDay,
        vlsfo_price: inputs.vlsfoPrice, lsmgo_price: inputs.lsmgoPrice,
        quantity_mt: Math.round(inputs.quantityMt), freight_usd_mt: inputs.freightUsdMt,
        commission_pct: inputs.commissionPct, load_rate_mt_day: Math.round(inputs.loadRateMtDay),
        disch_rate_mt_day: Math.round(inputs.dischRateMtDay),
        pol_da_usd: inputs.polDaUsd, pod_da_usd: inputs.podDaUsd, suez_usd: inputs.suezUsd,
        sea_days: r.seaDays, port_days: r.portDays,
        total_bunker_cost: r.bunkerCost, gross_freight: r.grossFreight, voyage_result: r.voyageResult,
      });
      if (error) throw error;
      toast.success("Estimate saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save estimate.");
    } finally {
      setSaving(false);
    }
  }

  const groups = ["Voyage", "Bunkers", "Cargo", "Port & Canal"];

  return (
    <div className="space-y-5">
      {/* Bunker ticker */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <Fuel className="h-4 w-4 text-ocean-600" />
        <span className="rounded-md bg-ocean-50 px-2 py-1 text-xs font-semibold text-ocean-700">
          VLSFO ${fuel?.vlsfo_usd_mt ?? "—"}/MT
        </span>
        <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
          LSMGO ${fuel?.lsmgo_usd_mt ?? "—"}/MT
        </span>
        <span className="text-xs text-slate-400">
          {fuel?.port_area ? `· ${fuel.port_area}` : ""} (editable below)
        </span>
      </div>

      {/* Prefill selectors */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-500">
          Prefill bunkers from open vessel
          <select
            value={selVessel}
            onChange={(e) => prefillVessel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800"
          >
            <option value="">— none —</option>
            {availabilities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.vessel?.vessel_name ?? "TBN"}
                {a.vessel?.dwt_grain ? ` · ${a.vessel.dwt_grain} DWT` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500">
          Prefill economics from cargo
          <select
            value={selCargo}
            onChange={(e) => prefillCargo(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800"
          >
            <option value="">— none —</option>
            {cargos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ref ? `${c.ref} · ` : ""}{c.commodity_name ?? "Cargo"} · {c.load_port_locode}→{c.disch_port_locode}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Inputs */}
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {groups.map((g) => (
            <fieldset key={g}>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {g}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.filter((f) => f.group === g).map((f) => (
                  <label key={f.key} className="text-xs font-medium text-slate-600">
                    {f.label}
                    <input
                      inputMode="decimal"
                      value={vals[f.key]}
                      onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-400/40"
                      placeholder="0"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {/* Result */}
        <div className="space-y-3 self-start rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Voyage result
          </h3>
          <Row label="Sea days" v={r.seaDays.toFixed(1)} />
          <Row label="Port days" v={r.portDays.toFixed(1)} />
          <Row label="VLSFO burned" v={`${r.vlsfoMt.toFixed(1)} MT`} />
          <Row label="LSMGO burned" v={`${r.lsmgoMt.toFixed(1)} MT`} />
          <div className="border-t border-slate-100 pt-2" />
          <Row label="Gross freight" v={money(r.grossFreight)} />
          <Row label="Commission" v={`− ${money(r.commission)}`} />
          <Row label="Bunker cost" v={`− ${money(r.bunkerCost)}`} />
          <Row label="Port + canal" v={`− ${money(r.portCosts)}`} />
          <div className="border-t border-slate-100 pt-2" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Voyage result</span>
            <span
              className={`text-lg font-bold ${
                r.voyageResult >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {money(r.voyageResult)}
            </span>
          </div>
          <Row label="TCE / day" v={money(r.tcePerDay)} />

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ocean-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ocean-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save estimate
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{v}</span>
    </div>
  );
}
