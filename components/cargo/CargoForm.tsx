"use client";

import { useState, useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Package,
  MapPin,
  Calendar,
  DollarSign,
  ShieldCheck,
  ArrowRight,
  Loader2,
  CheckCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  cargoFormSchema,
  CargoFormValues,
  CargoListingRow,
  CommodityOption,
  PortOption,
  computeCargoVolumeCbm,
  LOAD_TERMS,
  PACKAGING_TYPES,
  CSS_CATEGORIES,
  TOLERANCE_HOLDERS,
} from "@/lib/schemas/cargo";
import {
  submitCargo,
  updateCargo,
  getCargoSafetyAnswers,
} from "@/sdk/app/cargos";
import { getCommodityById } from "@/sdk/app/commodities";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { CommoditySelector } from "./CommoditySelector";
import { PortAutocomplete } from "./PortAutocomplete";
import { SafetyQuestionsStep } from "./SafetyQuestionsStep";
import { cn } from "@/lib/utils";
import { activeOrg, currentMember, ORG_TYPE_LABEL } from "@/lib/portal/org";
import { needsSuez } from "@/lib/portal/econ";

const STEPS = [
  { id: "commodity", label: "Cargo & Quantity", icon: Package },
  { id: "ports", label: "Ports", icon: MapPin },
  { id: "laycan", label: "Laycan & Terms", icon: Calendar },
  { id: "safety", label: "Safety", icon: ShieldCheck },
  { id: "review", label: "Review", icon: CheckCircle },
] as const;

const STEP_FIELDS: Record<number, (keyof CargoFormValues)[]> = {
  0: ["commodity_id", "qty_min_mt", "qty_max_mt"],
  1: ["load_port_locode", "disch_port_locode"],
  2: ["laycan_from", "laycan_to"],
  3: [],
  4: [],
};

interface CargoFormProps {
  initialData?: CargoListingRow;
  mode?: "create" | "edit";
}

export function CargoForm({ initialData, mode = "create" }: CargoFormProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitTriggeredByButtonRef = useRef(false);
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(
    mode === "edit" && !!initialData,
  );

  // Multi-port: up to 4 POL + 4 POD, each a port + call status. Index 0 is the
  // primary (drives load_port_locode/zone + matching); the rest are the range.
  type PortCall = { port: PortOption | null; status: string };
  const mkCall = (locode: string, name: string, country: string, zone: string, status = "Confirmed"): PortCall => ({
    port: { locode, trade_name: name, country, zone: zone as PortOption["zone"], port_type: "Sea Port" },
    status,
  });
  type PortRow = { locode: string; name?: string; country?: string; zone?: string; status?: string };
  const initPorts = (rows: PortRow[] | undefined, primary: () => PortCall): PortCall[] =>
    Array.isArray(rows) && rows.length
      ? rows.map((p) => mkCall(p.locode, p.name ?? "", p.country ?? "", p.zone ?? "", p.status ?? "Confirmed"))
      : [primary()];
  const idata = initialData as (CargoListingRow & { load_ports?: PortRow[]; disch_ports?: PortRow[] }) | undefined;
  const [polCalls, setPolCalls] = useState<PortCall[]>(
    initialData
      ? initPorts(idata?.load_ports, () => mkCall(initialData.load_port_locode, initialData.load_port_name, initialData.load_country, initialData.load_zone))
      : [{ port: null, status: "Confirmed" }],
  );
  const [podCalls, setPodCalls] = useState<PortCall[]>(
    initialData
      ? initPorts(idata?.disch_ports, () => mkCall(initialData.disch_port_locode, initialData.disch_port_name, initialData.disch_country, initialData.disch_zone))
      : [{ port: null, status: "Confirmed" }],
  );
  const loadPort = polCalls[0]?.port ?? null;
  const dischPort = podCalls[0]?.port ?? null;

  // In edit mode we need the real imsbc_category from the commodity table,
  // not a hard-coded "Cat_C". We resolve it after mount.
  const [selectedCommodity, setSelectedCommodity] =
    useState<CommodityOption | null>(null);

  const [safetyAnswers, setSafetyAnswers] = useState<Record<string, string>>(
    {},
  );
  const [safetyErrors, setSafetyErrors] = useState<Record<string, string>>({});

  const form = useForm<CargoFormValues>({
    resolver: zodResolver(cargoFormSchema),
    defaultValues: initialData
      ? {
          commodity_id: initialData.commodity_id,
          commodity_name: initialData.commodity_name,
          cargo_type: initialData.cargo_type,
          // imsbc_category will be updated once the commodity is resolved below
          imsbc_category: "Cat_C",
          is_dg_cargo: initialData.is_dg_cargo,
          is_grain_cargo: initialData.is_grain_cargo,
          stowage_factor: initialData.stowage_factor ?? undefined,
          qty_min_mt: initialData.qty_min_mt,
          qty_max_mt: initialData.qty_max_mt,
          load_port_locode: initialData.load_port_locode,
          disch_port_locode: initialData.disch_port_locode,
          laycan_from: initialData.laycan_from ?? "",
          laycan_to: initialData.laycan_to ?? "",
          load_rate: initialData.load_rate ?? undefined,
          disch_rate: initialData.disch_rate ?? undefined,
          load_terms: initialData.load_terms ?? undefined,
          freight_idea_usd_mt: initialData.freight_idea_usd_mt ?? undefined,
          commission_pct: initialData.commission_pct ?? undefined,
          demurrage_rate: initialData.demurrage_rate ?? undefined,
          despatch_rate: initialData.despatch_rate ?? undefined,
          broker: initialData.broker ?? "",
          notes: initialData.notes ?? "",
          safety_answers: {},
        }
      : {
          cargo_type: "Dry Bulk",
          is_dg_cargo: false,
          is_grain_cargo: false,
          qty_min_mt: 0,
          qty_max_mt: 0,
          load_port_locode: "",
          disch_port_locode: "",
          safety_answers: {},
        },
    mode: "onChange",
  });

  // Resolve the real commodity (with correct imsbc_category) and load saved answers
  useEffect(() => {
    if (mode !== "edit" || !initialData) return;

    const supabase = getSupabaseBrowserClient();

    const resolve = async () => {
      setIsLoadingInitialData(true);
      try {
        const [commodity, answers] = await Promise.all([
          initialData.commodity_id
            ? getCommodityById(supabase, initialData.commodity_id)
            : Promise.resolve(null),
          getCargoSafetyAnswers(supabase, initialData.id),
        ]);

        if (commodity) {
          setSelectedCommodity(commodity);
          form.setValue("imsbc_category", commodity.imsbc_category);
        } else {
          // Fallback: construct from listing row (imsbc_category unknown)
          setSelectedCommodity({
            id: initialData.commodity_id,
            canonical_name: initialData.commodity_name,
            cargo_type: initialData.cargo_type,
            imsbc_category: "Cat_C",
            is_dg: initialData.is_dg_cargo,
            is_grain: initialData.is_grain_cargo,
            default_sf_m3t: initialData.stowage_factor,
          });
        }

        if (Object.keys(answers).length > 0) {
          setSafetyAnswers(answers);
        }
      } catch (err) {
        console.error("Failed to load edit data:", err);
      } finally {
        setIsLoadingInitialData(false);
      }
    };

    resolve();
  }, [mode, initialData, form]);

  // ── Multi-port helpers ──
  const CALL_STATUSES = ["Confirmed", "Indicated", "TBA"];
  const callsOf = (which: "pol" | "pod") => (which === "pol" ? polCalls : podCalls);
  const setterOf = (which: "pol" | "pod") => (which === "pol" ? setPolCalls : setPodCalls);
  const syncPrimary = (which: "pol" | "pod", locode: string) =>
    form.setValue(which === "pol" ? "load_port_locode" : "disch_port_locode", locode, { shouldValidate: true });
  const pickPort = (which: "pol" | "pod", i: number, locode: string, port: PortOption) => {
    setterOf(which)((arr) => arr.map((c, idx) => (idx === i ? { ...c, port } : c)));
    if (i === 0) syncPrimary(which, locode);
  };
  const setStatus = (which: "pol" | "pod", i: number, status: string) =>
    setterOf(which)((arr) => arr.map((c, idx) => (idx === i ? { ...c, status } : c)));
  const addCall = (which: "pol" | "pod") =>
    setterOf(which)((arr) => (arr.length >= 4 ? arr : [...arr, { port: null, status: "Confirmed" }]));
  const removeCall = (which: "pol" | "pod", i: number) => {
    const remaining = callsOf(which).filter((_, idx) => idx !== i);
    setterOf(which)(remaining);
    if (i === 0) syncPrimary(which, remaining[0]?.port?.locode ?? "");
  };

  const handleCommodityChange = (commodity: CommodityOption) => {
    setSelectedCommodity(commodity);
    form.setValue("commodity_id", commodity.id, { shouldValidate: true });
    form.setValue("commodity_name", commodity.canonical_name);
    form.setValue("cargo_type", commodity.cargo_type);
    form.setValue("imsbc_category", commodity.imsbc_category);
    form.setValue("is_dg_cargo", commodity.is_dg);
    form.setValue("is_grain_cargo", commodity.is_grain);
    if (commodity.default_sf_m3t) {
      form.setValue("stowage_factor", commodity.default_sf_m3t);
    }
    // Reset safety answers when commodity changes
    setSafetyAnswers({});
    setSafetyErrors({});
  };

  // Validate required safety questions explicitly when leaving the safety step
  const validateSafetyAnswers = async (): Promise<boolean> => {
    if (!selectedCommodity) return true;

    const supabase = getSupabaseBrowserClient();
    const { getSafetyQuestions } = await import("@/sdk/app/commodities");
    const questions = await getSafetyQuestions(
      supabase,
      selectedCommodity.cargo_type,
      selectedCommodity.imsbc_category,
    );

    const newErrors: Record<string, string> = {};
    for (const q of questions) {
      if (q.is_required && !safetyAnswers[q.question_key]) {
        newErrors[q.question_key] = "This field is required";
      }
    }

    setSafetyErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const goNext = async () => {
    const fields = STEP_FIELDS[step];
    if (fields.length > 0) {
      const valid = await form.trigger(fields);
      if (!valid) return;
    }

    if (step === 3 && selectedCommodity) {
      const valid = await validateSafetyAnswers();
      if (!valid) {
        toast.error(
          "Please answer all required safety questions before continuing.",
        );
        return;
      }
    }

    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (data: CargoFormValues) => {
    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const portRows = (calls: PortCall[]) =>
        calls
          .filter((c) => c.port)
          .map((c) => ({
            locode: c.port!.locode,
            name: c.port!.trade_name,
            country: c.port!.country,
            zone: String(c.port!.zone),
            status: c.status,
          }));
      const payload: CargoFormValues = {
        ...data,
        safety_answers: safetyAnswers,
        load_ports: portRows(polCalls),
        disch_ports: portRows(podCalls),
      };

      if (mode === "edit" && initialData?.id) {
        await updateCargo(supabase, initialData.id, payload);
        toast.success("Cargo updated successfully.");
      } else {
        await submitCargo(supabase, payload);
        toast.success(
          "Cargo submitted! It will go live once reviewed by our team.",
        );
      }

      router.push("/dashboard/cargo");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const preventEnterSubmit = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    if (target.tagName === "TEXTAREA") return;
    event.preventDefault();
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (!submitTriggeredByButtonRef.current) {
      event.preventDefault();
      return;
    }

    submitTriggeredByButtonRef.current = false;
    void form.handleSubmit(onSubmit, (errors) =>
      console.log("Validation Errors:", errors),
    )(event);
  };

  const values = form.watch();

  if (isLoadingInitialData) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-asb-gray-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading cargo details…</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto relative max-[768px]:px-4">
      {/* Step indicator */}
      <div className="mb-8">
        <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isActive = idx === step;
            const isDone = idx < step;
            return (
              <div
                key={s.id}
                className="flex items-center flex-1 last:flex-none"
              >
                <div
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                    isActive && "bg-asb-blue text-white",
                    isDone && "bg-asb-blue-light text-asb-blue",
                    !isActive && !isDone && "text-asb-gray-400",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="inline max-[768px]:hidden">{s.label}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-0.5 mx-1 rounded-full transition-colors",
                      idx < step ? "bg-asb-blue" : "bg-asb-gray-100",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded shadow-sm border border-asb-gray-200 p-8 max-[768px]:p-6">
        <form
          onSubmit={handleFormSubmit}
          onKeyDown={preventEnterSubmit}
          className="space-y-5"
        >
          {/* ── Step 0: Cargo & Quantity ── */}
          {step === 0 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-2">
                <Package className="w-7 h-7 text-asb-blue" />
                <div>
                  <h2 className="text-xl font-bold text-asb-navy">
                    Cargo &amp; Quantity
                  </h2>
                  <p className="text-sm text-asb-gray-500">
                    Commodity, quantity and stowage. Cargo type, IMSBC category
                    and safety requirements are set automatically.
                  </p>
                </div>
              </div>

              <CommoditySelector
                selected={selectedCommodity}
                onChange={handleCommodityChange}
                error={form.formState.errors.commodity_id?.message}
              />

              {selectedCommodity && (
                <div>
                  <label className="text-sm font-semibold text-asb-ink-soft">
                    Stowage Factor (m³/t)
                    <span className="text-asb-gray-400 font-normal ml-1">
                      — pre-filled from commodity default, override if needed
                    </span>
                  </label>
                  <Controller
                    control={form.control}
                    name="stowage_factor"
                    render={({ field }) => (
                      <input
                        type="number"
                        step="0.01"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                          )
                        }
                        placeholder={
                          selectedCommodity.default_sf_m3t
                            ? String(selectedCommodity.default_sf_m3t)
                            : "e.g. 47.0"
                        }
                        className="mt-1.5 w-48 max-[768px]:w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                      />
                    )}
                  />
                </div>
              )}

              {/* Packing — break-bulk uses the 12 CSS Code categories; bulk keeps
                  the simple packaging types. */}
              {selectedCommodity && (
                <div>
                  <label className="text-sm font-semibold text-asb-ink-soft">
                    {values.cargo_type === "Break Bulk" ? "Packing (CSS category)" : "Packaging"}
                    <span className="text-asb-gray-400 font-normal ml-1 text-xs">
                      {values.cargo_type === "Break Bulk"
                        ? "— IMO CSS Code securing category"
                        : "— optional"}
                    </span>
                  </label>
                  {values.cargo_type === "Break Bulk" ? (
                    <Controller
                      control={form.control}
                      name="css_category"
                      render={({ field }) => (
                        <select
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || undefined)}
                          className="mt-1.5 w-full max-w-md h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none focus:border-asb-blue focus:bg-white transition-all"
                        >
                          <option value="">Select CSS category…</option>
                          {CSS_CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>{c.id} · {c.label}</option>
                          ))}
                        </select>
                      )}
                    />
                  ) : (
                    <Controller
                      control={form.control}
                      name="packaging_type"
                      render={({ field }) => (
                        <select
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange((e.target.value || undefined) as typeof field.value)}
                          className="mt-1.5 w-48 max-[768px]:w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none focus:border-asb-blue focus:bg-white transition-all"
                        >
                          <option value="">Select…</option>
                          {PACKAGING_TYPES.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      )}
                    />
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-asb-ink-soft">
                    Min Quantity (MT)
                  </label>
                  <Controller
                    control={form.control}
                    name="qty_min_mt"
                    render={({ field, fieldState }) => (
                      <>
                        <input
                          type="number"
                          min={1}
                          value={field.value || ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? 0
                                : Number(e.target.value),
                            )
                          }
                          className={cn(
                            "w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all",
                            fieldState.error && "border-red-300",
                          )}
                        />
                        {fieldState.error && (
                          <p className="text-xs text-red-500">
                            {fieldState.error.message}
                          </p>
                        )}
                      </>
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-asb-ink-soft">
                    Max Quantity (MT)
                  </label>
                  <Controller
                    control={form.control}
                    name="qty_max_mt"
                    render={({ field, fieldState }) => (
                      <>
                        <input
                          type="number"
                          min={1}
                          value={field.value || ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? 0
                                : Number(e.target.value),
                            )
                          }
                          className={cn(
                            "w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all",
                            fieldState.error && "border-red-300",
                          )}
                        />
                        {fieldState.error && (
                          <p className="text-xs text-red-500">
                            {fieldState.error.message}
                          </p>
                        )}
                      </>
                    )}
                  />
                </div>
              </div>

              {(() => {
                const qty = values.qty_max_mt;
                const sf = values.stowage_factor;
                const computed = computeCargoVolumeCbm(qty, sf);

                return (
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">
                      Cargo Volume (cbm)
                      <span className="text-asb-gray-400 font-normal ml-1 text-xs">
                        — optional; auto-computed from qty × stowage factor
                      </span>
                    </label>

                    {computed !== null && (
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs text-asb-gray-500">
                          Auto-computed:
                        </span>
                        <span className="text-xs font-bold text-asb-blue bg-asb-blue-light border border-asb-blue px-2 py-0.5 rounded-md">
                          {computed.toLocaleString()} cbm
                        </span>
                        <button
                          type="button"
                          className="text-xs text-asb-blue hover:text-asb-blue font-semibold underline"
                          onClick={() =>
                            form.setValue("volume_cbm", computed, {
                              shouldValidate: true,
                            })
                          }
                        >
                          Use this
                        </button>
                      </div>
                    )}

                    <Controller
                      control={form.control}
                      name="volume_cbm"
                      render={({ field }) => (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === ""
                                  ? undefined
                                  : Math.round(Number(e.target.value)),
                              )
                            }
                            placeholder={
                              computed !== null
                                ? String(computed)
                                : "e.g. 48 000"
                            }
                            className="w-48 max-[768px]:w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                          />
                          <span className="text-xs text-asb-gray-400 font-medium">
                            cbm
                          </span>
                          {field.value && (
                            <span className="text-xs text-asb-gray-400">
                              ≈{" "}
                              {Math.round(
                                field.value * 35.3147,
                              ).toLocaleString()}{" "}
                              cbft
                            </span>
                          )}
                        </div>
                      )}
                    />

                    {computed !== null &&
                      values.volume_cbm &&
                      values.volume_cbm !== computed && (
                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                          Manual override — differs from auto-computed{" "}
                          {computed.toLocaleString()} cbm.
                        </p>
                      )}

                    <p className="text-xs text-asb-gray-400">
                      Used to verify the cargo fits in the vessel hold.
                      Relationship: Volume = Qty (MT) × Stowage Factor (m³/t).
                    </p>
                  </div>
                );
              })()}

              {/* MOL — quantity tolerance % + option holder (MOLOO/MOLCHOPT) */}
              {selectedCommodity && (
                <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">
                      Quantity tolerance (MOL %)
                      <span className="text-asb-gray-400 font-normal ml-1 text-xs">— optional</span>
                    </label>
                    <Controller
                      control={form.control}
                      name="tolerance_pct"
                      render={({ field }) => (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            step={1}
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                            placeholder="e.g. 5"
                            className="w-28 h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none focus:border-asb-blue focus:bg-white transition-all"
                          />
                          <span className="text-xs text-asb-gray-400">%</span>
                        </div>
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">Option holder</label>
                    <Controller
                      control={form.control}
                      name="tolerance_holder"
                      render={({ field, fieldState }) => (
                        <>
                          <select
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange((e.target.value || undefined) as typeof field.value)}
                            className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none focus:border-asb-blue focus:bg-white transition-all"
                          >
                            <option value="">—</option>
                            {TOLERANCE_HOLDERS.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          {fieldState.error && <p className="text-xs text-red-500">{fieldState.error.message}</p>}
                        </>
                      )}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 1: Ports ── */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-2">
                <MapPin className="w-7 h-7 text-asb-blue" />
                <div>
                  <h2 className="text-xl font-bold text-asb-navy">
                    Ports
                  </h2>
                  <p className="text-sm text-asb-gray-500">
                    POL / POD. Zone is auto-filled from the port — never type it
                    manually.
                  </p>
                </div>
              </div>


              {/* ── Load Port(s) — up to 4 ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-asb-ink-soft">Load Port(s) (POL)</span>
                  {polCalls.length < 4 && (
                    <button type="button" className="text-xs text-asb-blue font-semibold hover:underline" onClick={() => addCall("pol")}>
                      + Add {polCalls.length === 1 ? "2nd" : `port ${polCalls.length + 1}`} load port
                    </button>
                  )}
                </div>
                {polCalls.map((c, i) => (
                  <div key={i} className="space-y-1.5 border border-asb-gray-100 rounded p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        {i === 0 ? (
                          <Controller
                            control={form.control}
                            name="load_port_locode"
                            render={({ fieldState }) => (
                              <PortAutocomplete label={`Primary`} selectedPort={c.port} onChange={(locode, port) => pickPort("pol", i, locode, port)} error={fieldState.error?.message} placeholder="Search load port…" />
                            )}
                          />
                        ) : (
                          <PortAutocomplete label={`Alt ${i}`} selectedPort={c.port} onChange={(locode, port) => pickPort("pol", i, locode, port)} placeholder={`Search load port ${i + 1}…`} />
                        )}
                      </div>
                      {i > 0 && (
                        <button type="button" onClick={() => removeCall("pol", i)} className="mt-7 text-asb-gray-400 hover:text-red-500" aria-label="Remove port">✕</button>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      {CALL_STATUSES.map((s) => (
                        <button key={s} type="button" onClick={() => setStatus("pol", i, s)} className={cn("text-xs px-2.5 py-1 rounded-full border transition-colors", c.status === s ? "bg-asb-blue-light border-asb-blue text-asb-blue font-semibold" : "border-asb-gray-200 text-asb-gray-500 hover:border-asb-gray-300")}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Discharge Port(s) — up to 4 ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-asb-ink-soft">Discharge Port(s) (POD)</span>
                  {podCalls.length < 4 && (
                    <button type="button" className="text-xs text-asb-blue font-semibold hover:underline" onClick={() => addCall("pod")}>
                      + Add {podCalls.length === 1 ? "2nd" : `port ${podCalls.length + 1}`} disch port
                    </button>
                  )}
                </div>
                {podCalls.map((c, i) => (
                  <div key={i} className="space-y-1.5 border border-asb-gray-100 rounded p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        {i === 0 ? (
                          <Controller
                            control={form.control}
                            name="disch_port_locode"
                            render={({ fieldState }) => (
                              <PortAutocomplete label={`Primary`} selectedPort={c.port} onChange={(locode, port) => pickPort("pod", i, locode, port)} error={fieldState.error?.message} placeholder="Search discharge port…" />
                            )}
                          />
                        ) : (
                          <PortAutocomplete label={`Alt ${i}`} selectedPort={c.port} onChange={(locode, port) => pickPort("pod", i, locode, port)} placeholder={`Search discharge port ${i + 1}…`} />
                        )}
                      </div>
                      {i > 0 && (
                        <button type="button" onClick={() => removeCall("pod", i)} className="mt-7 text-asb-gray-400 hover:text-red-500" aria-label="Remove port">✕</button>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      {CALL_STATUSES.map((s) => (
                        <button key={s} type="button" onClick={() => setStatus("pod", i, s)} className={cn("text-xs px-2.5 py-1 rounded-full border transition-colors", c.status === s ? "bg-asb-blue-light border-asb-blue text-asb-blue font-semibold" : "border-asb-gray-200 text-asb-gray-500 hover:border-asb-gray-300")}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {loadPort && dischPort && needsSuez(loadPort.zone, dischPort.zone) && (
                <div className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-800">
                  <span className="font-semibold whitespace-nowrap">⚓ Suez transit</span>
                  <span className="text-amber-700">
                    This {loadPort.zone} → {dischPort.zone} route transits the Suez
                    Canal — canal tolls apply (estimate them in the Voyage Estimator).
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Laycan & Terms ── */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="w-7 h-7 text-asb-blue" />
                <div>
                  <h2 className="text-xl font-bold text-asb-navy">
                    Laycan & Commercial Terms
                  </h2>
                  <p className="text-sm text-asb-gray-500">
                    All fields optional. Leave laycan blank for SPOT cargo.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-asb-ink-soft">
                    Laycan From
                  </label>
                  <input
                    type="date"
                    {...form.register("laycan_from")}
                    className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                  />
                  {form.formState.errors.laycan_from && (
                    <p className="text-xs text-red-500">
                      {form.formState.errors.laycan_from.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-asb-ink-soft">
                    Laycan To
                  </label>
                  <input
                    type="date"
                    {...form.register("laycan_to")}
                    className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                  />
                  {form.formState.errors.laycan_to && (
                    <p className="text-xs text-red-500">
                      {form.formState.errors.laycan_to.message}
                    </p>
                  )}
                </div>
              </div>

              {!values.laycan_from && !values.laycan_to && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                  No laycan set — this cargo will be listed as SPOT and will
                  match any open vessel date.
                </p>
              )}

              <div className="border-t border-asb-gray-100 pt-5">
                <div className="flex items-center gap-2 mb-4">
                  <DollarSign className="w-5 h-5 text-asb-blue" />
                  <h3 className="text-base font-semibold text-asb-ink">
                    Commercial Terms
                  </h3>
                  <span className="text-xs text-asb-gray-400">
                    — all optional, improves match ranking
                  </span>
                </div>

                <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">
                      Load Terms
                    </label>
                    <select
                      {...form.register("load_terms", {
                        setValueAs: (v) => (v === "" ? undefined : v),
                      })}
                      className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                    >
                      <option value="">Select terms…</option>
                      {LOAD_TERMS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">
                      Freight Idea ($/MT)
                    </label>
                    <Controller
                      control={form.control}
                      name="freight_idea_usd_mt"
                      render={({ field }) => (
                        <input
                          type="number"
                          step="0.01"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                            )
                          }
                          placeholder="e.g. 22.50"
                          className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                        />
                      )}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">
                      Load Rate (MT/day)
                    </label>
                    <Controller
                      control={form.control}
                      name="load_rate"
                      render={({ field }) => (
                        <input
                          type="number"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                            )
                          }
                          placeholder="e.g. 2000"
                          className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                        />
                      )}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">
                      Discharge Rate (MT/day)
                    </label>
                    <Controller
                      control={form.control}
                      name="disch_rate"
                      render={({ field }) => (
                        <input
                          type="number"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                            )
                          }
                          placeholder="e.g. 1500"
                          className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                        />
                      )}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">
                      Demurrage ($/day)
                    </label>
                    <Controller
                      control={form.control}
                      name="demurrage_rate"
                      render={({ field }) => (
                        <input
                          type="number"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                            )
                          }
                          className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                        />
                      )}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-asb-ink-soft">
                      Commission (%)
                    </label>
                    <Controller
                      control={form.control}
                      name="commission_pct"
                      render={({ field }) => (
                        <input
                          type="number"
                          step="0.25"
                          min={0}
                          max={100}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                            )
                          }
                          placeholder="e.g. 2.5"
                          className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                        />
                      )}
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-1.5">
                  <label className="text-sm font-semibold text-asb-ink-soft">
                    Broker / Reference
                  </label>
                  <input
                    type="text"
                    {...form.register("broker")}
                    placeholder="e.g. Company name / contact ref"
                    className="w-full h-10 px-3 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all"
                  />
                </div>

                <div className="mt-4 space-y-1.5">
                  <label className="text-sm font-semibold text-asb-ink-soft">
                    Additional Notes
                  </label>
                  <textarea
                    {...form.register("notes")}
                    rows={2}
                    placeholder="Any special requirements or notes…"
                    className="w-full px-3 py-2 rounded border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none  focus:border-asb-blue focus:bg-white transition-all resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Safety Questions ── */}
          {step === 3 && selectedCommodity && (
            <div className="animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-6">
                <ShieldCheck className="w-7 h-7 text-asb-blue" />
                <div>
                  <h2 className="text-xl font-bold text-asb-navy">
                    Safety & Vessel Requirements
                  </h2>
                  <p className="text-sm text-asb-gray-500">
                    Questions are specific to {selectedCommodity.canonical_name}{" "}
                    ({selectedCommodity.imsbc_category}). Answers tagged
                    &quot;used in matching&quot; drive vessel filtering.
                  </p>
                </div>
              </div>
              <SafetyQuestionsStep
                cargoType={selectedCommodity.cargo_type}
                imsbcCategory={selectedCommodity.imsbc_category}
                values={safetyAnswers}
                onChange={(key, value) =>
                  setSafetyAnswers((prev) => ({ ...prev, [key]: value }))
                }
                errors={safetyErrors}
              />
            </div>
          )}

          {/* ── Step 4: Review ── */}
          {step === 4 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle className="w-7 h-7 text-asb-blue" />
                <div>
                  <h2 className="text-xl font-bold text-asb-navy">
                    Review & Submit
                  </h2>
                  <p className="text-sm text-asb-gray-500">
                    Double-check before submitting. Your listing will be
                    reviewed before going live.
                  </p>
                </div>
              </div>

              <div className="bg-asb-gray-50 rounded border border-asb-gray-200 divide-y divide-slate-200">
                <ReviewRow
                  label="Commodity"
                  value={values.commodity_name ?? "—"}
                />
                <ReviewRow
                  label="Cargo type"
                  value={values.cargo_type ?? "—"}
                />
                <ReviewRow label="IMSBC" value={values.imsbc_category ?? "—"} />
                <ReviewRow
                  label="Packing"
                  value={
                    values.cargo_type === "Break Bulk"
                      ? values.css_category
                        ? `${values.css_category} · ${CSS_CATEGORIES.find((c) => c.id === values.css_category)?.label ?? ""}`
                        : "—"
                      : values.packaging_type ?? "—"
                  }
                />
                <ReviewRow
                  label="Quantity"
                  value={`${values.qty_min_mt?.toLocaleString()} – ${values.qty_max_mt?.toLocaleString()} MT`}
                />
                {values.volume_cbm && (
                  <ReviewRow
                    label="Volume"
                    value={`${values.volume_cbm.toLocaleString()} cbm`}
                  />
                )}
                {values.stowage_factor && (
                  <ReviewRow
                    label="Stowage factor"
                    value={`${Number(values.stowage_factor).toFixed(2)} m³/t · ${Math.round(Number(values.stowage_factor) * 35.87)} ft³/t`}
                  />
                )}
                <ReviewRow
                  label="Load port"
                  value={
                    loadPort
                      ? `${loadPort.trade_name} (${loadPort.locode}) — ${loadPort.zone}`
                      : (values.load_port_locode ?? "—")
                  }
                />
                <ReviewRow
                  label="Discharge port"
                  value={
                    dischPort
                      ? `${dischPort.trade_name} (${dischPort.locode}) — ${dischPort.zone}`
                      : (values.disch_port_locode ?? "—")
                  }
                />
                <ReviewRow
                  label="Laycan"
                  value={
                    values.laycan_from
                      ? `${values.laycan_from} – ${values.laycan_to || "?"}`
                      : "SPOT (no laycan)"
                  }
                />
                {values.load_terms && (
                  <ReviewRow label="Load terms" value={values.load_terms} />
                )}
                {values.freight_idea_usd_mt && (
                  <ReviewRow
                    label="Freight idea"
                    value={`$${values.freight_idea_usd_mt}/MT`}
                  />
                )}
                {values.broker && (
                  <ReviewRow label="Broker ref" value={values.broker} />
                )}
              </div>

              {/* Org model — Posted by + company-desk visibility (handoff §6) */}
              {(() => {
                const org = activeOrg();
                const me = currentMember();
                return (
                  <div className="bg-white border border-asb-gray-200 rounded p-4">
                    <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-3">
                      Posted by
                    </p>
                    <div className="bg-asb-gray-50 rounded border border-asb-gray-200 divide-y divide-slate-200">
                      <ReviewRow label="Company" value={org.name} />
                      <ReviewRow label="Type" value={ORG_TYPE_LABEL[org.type]} />
                      <ReviewRow label="Country" value={org.country} />
                      <ReviewRow label="Subscription" value={org.tier} />
                      <ReviewRow label="Handled by" value={me.name} />
                      <ReviewRow label="Desk" value={org.desk.name} />
                      <ReviewRow label="Desk email" value={org.desk.email} />
                      <ReviewRow label="Desk phone" value={org.desk.phone} />
                    </div>
                    <p className="text-xs text-asb-gray-400 mt-3">
                      This listing circulates under the{" "}
                      <strong className="text-asb-gray-600">{org.desk.name}</strong>{" "}
                      — enquiries route to {org.desk.email}. Counterparties see the
                      company, flagged “handled by {me.name}”; no individual direct
                      line is shown. If {me.name} leaves, the listing stays with{" "}
                      {org.name}.
                    </p>
                  </div>
                );
              })()}

              {Object.keys(safetyAnswers).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-asb-gray-500 uppercase tracking-wider mb-2">
                    Safety answers ({Object.keys(safetyAnswers).length})
                  </p>
                  <div className="bg-asb-gray-50 rounded border border-asb-gray-200 divide-y divide-slate-200">
                    {Object.entries(safetyAnswers).map(([key, val]) => (
                      <ReviewRow key={key} label={key} value={String(val)} />
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">What happens next?</p>
                <p>
                  Your listing will be reviewed by our team (SLA: 2 hours during
                  business hours). Once approved, it will go live in the
                  marketplace and be included in vessel matchmaking.
                </p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between items-center pt-8 mt-6 border-t border-asb-gray-100">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0}
              className="px-5 py-2.5 font-semibold text-asb-gray-700 hover:bg-asb-gray-50 rounded transition-colors disabled:invisible"
            >
              ← Back
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={goNext}
                className="px-7 py-3 bg-asb-blue text-white font-bold rounded flex items-center gap-2 hover:bg-asb-navy transition-colors"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                onClick={() => {
                  submitTriggeredByButtonRef.current = true;
                }}
                disabled={isSubmitting}
                className="px-7 py-3 bg-asb-blue text-white font-bold rounded flex items-center gap-2 hover:bg-asb-navy transition-colors disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Submitting…
                  </>
                ) : mode === "edit" ? (
                  "Save Changes"
                ) : (
                  "Submit Listing"
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center px-4 py-2.5 text-sm">
      <span className="text-asb-gray-500 font-medium">{label}</span>
      <span className="text-asb-navy font-semibold text-right wrap-break-word max-w-[68%]">
        {value}
      </span>
    </div>
  );
}
