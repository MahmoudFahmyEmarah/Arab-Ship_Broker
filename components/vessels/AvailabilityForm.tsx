"use client";

import { useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Ship,
  MapPin,
  TrendingUp,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  ExternalLink,
  Plus,
  X,
  AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";

import {
  availabilityFormSchema,
  AvailabilityFormValues,
  VesselRow,
  VesselAvailabilityRow,
} from "@/lib/schemas/vessel";
import {
  submitVesselAvailability,
  updateVesselAvailability,
} from "@/sdk/app/vessels";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { VesselSearch } from "./VesselSearch";
import { PortAutocomplete } from "@/components/cargo/PortAutocomplete";
import { PortOption } from "@/lib/schemas/cargo";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "vessel", label: "Select vessel", icon: Ship },
  { id: "port_date", label: "Port & date", icon: MapPin },
  { id: "commercial", label: "Commercial Terms", icon: TrendingUp }, // M1
  { id: "review", label: "Review", icon: CheckCircle },
] as const;

const STEP_FIELDS: Record<number, (keyof AvailabilityFormValues)[]> = {
  0: ["vessel_id"],
  1: ["open_port_locode", "open_date"],
  2: [],
  3: [],
};

interface AvailabilityFormProps {
  initialData?: VesselAvailabilityRow & { vessel: VesselRow };
  mode?: "create" | "edit";
  prefilledVessel?: VesselRow | null;
}
interface AddPortState {
  portName: string;
  country: string;
  notes: string;
}

function humanizeError(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (
    message.includes("received undefined") ||
    message.includes("expected string") ||
    message.includes("Invalid input")
  ) {
    return "Please select a trade zone before submitting.";
  }
  return message;
}

function getOpenDateUrgency(dateStr: string): {
  color: string;
  label: string;
} | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const open = new Date(dateStr);
  const diffDays = Math.ceil((open.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { color: "text-red-600", label: "Overdue" };
  if (diffDays <= 7)
    return { color: "text-amber-600", label: `Due in ${diffDays}d` };
  return { color: "text-green-600", label: "On track" };
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center px-4 py-2.5 text-sm">
      <span className="text-slate-500 font-medium">{label}</span>
      <span className="text-slate-900 font-semibold text-right word-break max-w-[60%]">
        {value}
      </span>
    </div>
  );
}

export function AvailabilityForm({
  initialData,
  mode = "create",
  prefilledVessel,
}: AvailabilityFormProps) {
  const router = useRouter();
  const submitTriggeredByButtonRef = useRef(false);

  const startingStep = initialData || prefilledVessel ? 1 : 0;
  const [step, setStep] = useState(startingStep);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedVessel, setSelectedVessel] = useState<VesselRow | null>(
    prefilledVessel ?? initialData?.vessel ?? null,
  );
  const [openPort, setOpenPort] = useState<PortOption | null>(null);
  const [ballastPort, setBallastPort] = useState<PortOption | null>(null);

  const [showAddPort, setShowAddPort] = useState(false);
  const [addPortState, setAddPortState] = useState<AddPortState>({
    portName: "",
    country: "",
    notes: "",
  });
  const [addPortSubmitting, setAddPortSubmitting] = useState(false);

  const form = useForm<AvailabilityFormValues>({
    resolver: zodResolver(availabilityFormSchema),
    defaultValues: initialData
      ? {
          vessel_id: initialData.vessel_id,
          open_port_locode: initialData.open_port_locode ?? "",
          ballast_port_locode: initialData.ballast_port_locode ?? "",
          open_date: initialData.open_date ?? "",
          open_date_range_days: initialData.open_date_range_days ?? 7,
          last_cargo: initialData.last_cargo ?? "",
          accepts_part_cargo: initialData.accepts_part_cargo ?? false,
          service_speed_kn: initialData.service_speed_kn ?? undefined,
          me_consumption_mt_day: initialData.me_consumption_mt_day ?? undefined,
          me_consumption_port_mt_day:
            initialData.me_consumption_port_mt_day ?? undefined,
          aux_consumption_mt_day:
            initialData.aux_consumption_mt_day ?? undefined,
          aux_consumption_port_mt_day:
            initialData.aux_consumption_port_mt_day ?? undefined,
          fuel_type: initialData.fuel_type ?? undefined,
          notes: initialData.notes ?? "",
        }
      : prefilledVessel
        ? {
            vessel_id: prefilledVessel.id,
            open_date_range_days: 7,
            accepts_part_cargo: false,
          }
        : {
            open_date_range_days: 7,
            accepts_part_cargo: false,
          },
    mode: "onChange",
  });

  const values = form.watch();

  const goNext = async () => {
    const fields = STEP_FIELDS[step];
    if (fields.length > 0) {
      const valid = await form.trigger(fields);
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    if (step === 1 && prefilledVessel) {
      router.push(`/dashboard/vessels/${prefilledVessel.id}`);
      return;
    }
    setStep((s) => Math.max(s - 1, 0));
  };

  const onSubmit = async (data: AvailabilityFormValues) => {
    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (mode === "edit" && initialData?.id) {
        await updateVesselAvailability(supabase, initialData.id, data);
        toast.success("Position updated.");
      } else {
        await submitVesselAvailability(supabase, data);
        toast.success(
          "Your position has been submitted to Arab ShipBroker. Once reviewed, it will be published on the tonnage board and cargo matching will begin. You will be notified when your position is active.",
        );
      }
      router.push("/dashboard/vessels");
      router.refresh();
    } catch (err) {
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
    void form.handleSubmit(onSubmit)(event);
  };

  const vesselLocked = mode === "edit" || !!prefilledVessel;

  const handleAddPortSubmit = async () => {
    if (!addPortState.portName.trim() || !addPortState.country.trim()) {
      toast.error("Port name and country are required.");
      return;
    }
    setAddPortSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const locode = `ZZ ${addPortState.portName
        .trim()
        .substring(0, 3)
        .toUpperCase()}`;
      const { error } = await supabase.from("ports").insert({
        locode,
        trade_name: addPortState.portName.trim(),
        country: addPortState.country.trim(),
        zone: "Unknown",
        is_verified: false,
        is_active: true,
        notes: addPortState.notes.trim() || null,
      });
      if (error) throw error;
      toast.success(
        "Port submitted. Will show as pending verification until Arab ShipBroker confirms it.",
      );
      setShowAddPort(false);
      setAddPortState({ portName: "", country: "", notes: "" });
    } catch {
      toast.error("Failed to submit port. Please try again.");
    } finally {
      setAddPortSubmitting(false);
    }
  };

  const inputCls =
    "w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all";

  return (
    <div className="max-w-3xl mx-auto max-[768px]:px-4">
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          const isActive = idx === step;
          const isCompleted = vesselLocked
            ? idx === 0 || idx < step
            : idx < step;
          const isFuture = !isActive && !isCompleted;
          return (
            <div key={s.id} className="flex items-center flex-1 last:flex-none">
              <div
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                  isActive && "bg-ocean-600 text-white",
                  isCompleted && "bg-ocean-100 text-ocean-700",
                  isFuture && "text-slate-400",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="inline max-[768px]:hidden">{s.label}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-1 rounded-full transition-colors",
                    isCompleted ? "bg-ocean-400" : "bg-slate-100",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-[768px]:p-6">
        <form onSubmit={handleFormSubmit} onKeyDown={preventEnterSubmit}>
          {step === 0 && !vesselLocked && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0">
                  <Ship className="w-5 h-5 text-ocean-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Select your vessel
                  </h2>
                  <p className="text-sm text-slate-500">
                    Search the vessel intelligence register.
                  </p>
                </div>
              </div>

              <Controller
                control={form.control}
                name="vessel_id"
                render={({ fieldState }) => (
                  <VesselSearch
                    selected={selectedVessel}
                    onChange={(v) => {
                      setSelectedVessel(v);
                      form.setValue("vessel_id", v.id, {
                        shouldValidate: true,
                      });
                    }}
                    error={humanizeError(fieldState.error?.message)}
                  />
                )}
              />
            </div>
          )}

          {step >= 1 && vesselLocked && selectedVessel && (
            <div className="mb-6 p-4 rounded-xl border border-ocean-200 bg-ocean-50 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Ship className="w-5 h-5 text-ocean-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {selectedVessel.vessel_name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedVessel.vessel_type}
                    {selectedVessel.imo_number &&
                      ` · IMO ${selectedVessel.imo_number}`}
                    {selectedVessel.dwt_grain &&
                      ` · ${selectedVessel.dwt_grain.toLocaleString()} MT DWT`}
                  </p>
                </div>
              </div>
              {prefilledVessel && (
                <Link
                  href={`/dashboard/vessels/${prefilledVessel.id}`}
                  className="text-xs text-ocean-600 hover:text-ocean-700 font-semibold flex items-center gap-1 shrink-0"
                >
                  View vessel <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5 text-ocean-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Open port & date
                  </h2>
                  <p className="text-sm text-slate-500">
                    Zone auto-fills from the port — it is the primary
                    matchmaking field.
                  </p>
                </div>
              </div>

              <Controller
                control={form.control}
                name="open_port_locode"
                render={({ fieldState }) => (
                  <PortAutocomplete
                    label="Open at port"
                    selectedPort={openPort}
                    onChange={(locode, port) => {
                      setOpenPort(port);
                      form.setValue("open_port_locode", locode ?? "", {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                    }}
                    error={humanizeError(fieldState.error?.message)}
                  />
                )}
              />

              <Controller
                control={form.control}
                name="ballast_port_locode"
                render={() => (
                  <PortAutocomplete
                    label="Ballast port (optional)"
                    selectedPort={ballastPort}
                    onChange={(locode, port) => {
                      setBallastPort(port);
                      form.setValue("ballast_port_locode", locode ?? "", {
                        shouldDirty: true,
                      });
                    }}
                  />
                )}
              />

              <button
                type="button"
                onClick={() => setShowAddPort(true)}
                className="text-xs text-ocean-600 hover:text-ocean-700 font-semibold flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Port not listed? Submit to Arab
                ShipBroker
              </button>

              <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Open date
                  </label>
                  <input
                    type="date"
                    {...form.register("open_date")}
                    min={new Date().toISOString().split("T")[0]}
                    className={inputCls}
                  />
                  {form.formState.errors.open_date && (
                    <p className="text-xs text-red-500">
                      {humanizeError(form.formState.errors.open_date.message)}
                    </p>
                  )}
                  {values.open_date &&
                    (() => {
                      const u = getOpenDateUrgency(values.open_date);
                      return u ? (
                        <p
                          className={cn(
                            "text-xs flex items-center gap-1",
                            u.color,
                          )}
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          {u.label}
                        </p>
                      ) : null;
                    })()}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Date flexibility{" "}
                    <span className="text-xs font-normal text-slate-400">
                      (± days)
                    </span>
                  </label>
                  <Controller
                    control={form.control}
                    name="open_date_range_days"
                    render={({ field }) => (
                      <input
                        type="number"
                        min={0}
                        max={21}
                        value={field.value ?? 7}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className={inputCls}
                      />
                    )}
                  />
                  <p className="text-xs text-slate-400">
                    Days either side of open date acceptable for laycan
                    matching.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Last cargo
                </label>
                <input
                  type="text"
                  {...form.register("last_cargo")}
                  placeholder="e.g. Wheat, Clean"
                  className={inputCls}
                />
                <p className="text-xs text-slate-400">
                  Feeds future cargo compatibility checks.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Controller
                  control={form.control}
                  name="accepts_part_cargo"
                  render={({ field }) => (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={field.value}
                      onClick={() => field.onChange(!field.value)}
                      className={cn(
                        "relative w-11 h-6 rounded-full transition-colors shrink-0",
                        field.value ? "bg-ocean-600" : "bg-slate-200",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                          field.value && "translate-x-5",
                        )}
                      />
                    </button>
                  )}
                />
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    Accept part cargo
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-5 h-5 text-ocean-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Commercial Terms{" "}
                    <span className="text-slate-400 font-normal text-base">
                      (optional)
                    </span>
                  </h2>
                  <p className="text-sm text-slate-500">
                    Performance data improves voyage cost estimates.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Performance
                </p>
                <p className="text-xs text-slate-400">
                  Speed and consumption figures may be referenced during
                  negotiations and on-subs stage.
                </p>
                <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                  {(
                    [
                      {
                        name: "service_speed_kn",
                        label: "Service speed (kn)",
                        placeholder: "e.g. 12.5",
                        step: "0.1",
                      },
                      {
                        name: "me_consumption_mt_day",
                        label: "ME cons. sea (MT/day)",
                        placeholder: "e.g. 18.0",
                        step: "0.01",
                      },
                      {
                        name: "me_consumption_port_mt_day",
                        label: "ME cons. port (MT/day)",
                        placeholder: "e.g. 2.0",
                        step: "0.01",
                      },
                      {
                        name: "aux_consumption_mt_day",
                        label: "AUX cons. sea (MT/day)",
                        placeholder: "e.g. 1.5",
                        step: "0.01",
                      },
                      {
                        name: "aux_consumption_port_mt_day",
                        label: "AUX cons. port (MT/day)",
                        placeholder: "e.g. 1.0",
                        step: "0.01",
                      },
                    ] as const
                  ).map(({ name, label, placeholder, step: s }) => (
                    <div key={name} className="space-y-1.5">
                      <label className="text-sm font-semibold text-slate-700">
                        {label}
                      </label>
                      <Controller
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <input
                            type="number"
                            step={s}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                              )
                            }
                            placeholder={placeholder}
                            className={inputCls}
                          />
                        )}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                  Commercial
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Fuel type
                  </label>
                  <Controller
                    control={form.control}
                    name="fuel_type"
                    render={({ field }) => (
                      <select
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value || undefined)
                        }
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all"
                      >
                        <option value="">Select fuel type (optional)</option>
                        <option value="VLSFO">VLSFO</option>
                        <option value="HSFO">HSFO</option>
                        <option value="MGO">MGO</option>
                        <option value="MDO">MDO</option>
                        <option value="LNG">LNG</option>
                        <option value="Biofuel blend">Biofuel blend</option>
                      </select>
                    )}
                  />
                  <p className="text-xs text-slate-400">
                    Optional. Helps align bunker assumptions during commercial
                    discussions.
                  </p>
                </div>
                <div className="mt-4 space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Notes
                  </label>
                  <textarea
                    {...form.register("notes")}
                    rows={2}
                    placeholder="Any additional notes for this position…"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0">
                  <CheckCircle className="w-5 h-5 text-ocean-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Review & submit position
                  </h2>
                  <p className="text-sm text-slate-500">
                    Confirm details before submitting.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200">
                <ReviewRow
                  label="Vessel"
                  value={selectedVessel?.vessel_name ?? "—"}
                />
                <ReviewRow
                  label="Vessel type"
                  value={selectedVessel?.vessel_type ?? "—"}
                />
                <ReviewRow
                  label="DWT (grain)"
                  value={
                    selectedVessel?.dwt_grain
                      ? `${selectedVessel.dwt_grain.toLocaleString()} MT`
                      : "—"
                  }
                />
                <ReviewRow
                  label="Open port"
                  value={
                    openPort
                      ? `${openPort.trade_name} (${openPort.locode}) · ${openPort.zone}`
                      : (values.open_port_locode ?? "—")
                  }
                />
                {(ballastPort || values.ballast_port_locode) && (
                  <ReviewRow
                    label="Ballast port"
                    value={
                      ballastPort
                        ? `${ballastPort.trade_name} (${ballastPort.locode}) · ${ballastPort.zone}`
                        : (values.ballast_port_locode ?? "—")
                    }
                  />
                )}
                <ReviewRow label="Open date" value={values.open_date ?? "—"} />
                <ReviewRow
                  label="Date flexibility"
                  value={`±${values.open_date_range_days ?? 7} days`}
                />
                <ReviewRow
                  label="Accepts part cargo"
                  value={(values.accepts_part_cargo ?? false) ? "Yes" : "No"}
                />
                {values.last_cargo && (
                  <ReviewRow label="Last cargo" value={values.last_cargo} />
                )}
                {values.service_speed_kn && (
                  <ReviewRow
                    label="Service speed"
                    value={`${values.service_speed_kn} kn`}
                  />
                )}
                {values.fuel_type && (
                  <ReviewRow label="Fuel type" value={values.fuel_type} />
                )}
                {values.me_consumption_mt_day && (
                  <ReviewRow
                    label="ME cons. sea"
                    value={`${values.me_consumption_mt_day} MT/day`}
                  />
                )}
                {values.me_consumption_port_mt_day && (
                  <ReviewRow
                    label="ME cons. port"
                    value={`${values.me_consumption_port_mt_day} MT/day`}
                  />
                )}
                {values.aux_consumption_mt_day && (
                  <ReviewRow
                    label="AUX cons. sea"
                    value={`${values.aux_consumption_mt_day} MT/day`}
                  />
                )}
                {values.aux_consumption_port_mt_day && (
                  <ReviewRow
                    label="AUX cons. port"
                    value={`${values.aux_consumption_port_mt_day} MT/day`}
                  />
                )}
              </div>

              {selectedVessel?.risk_level === "HIGH" && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                  <p className="font-semibold">Additional review required</p>
                  <p className="text-xs mt-1 text-amber-700">
                    This position will be reviewed by Arab ShipBroker before
                    going live.
                  </p>
                </div>
              )}

              <div className="bg-ocean-50 border border-ocean-200 rounded-xl p-4 text-sm text-ocean-800">
                <p className="font-semibold">What happens next</p>
                <p className="text-xs mt-1 text-ocean-700 leading-relaxed">
                  Your position has been submitted to Arab ShipBroker. Once
                  reviewed, it will be published on the tonnage board and cargo
                  matching will begin. You will be notified when your position
                  is active.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-8 mt-6 border-t border-slate-100">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0 && !prefilledVessel}
              className="px-5 py-2.5 font-semibold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors disabled:invisible flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={selectedVessel?.vessel_review_status === "IN_REVIEW"}
                className="px-7 py-3 bg-ocean-600 text-white font-bold rounded-xl flex items-center gap-2 hover:bg-ocean-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                onClick={() => {
                  submitTriggeredByButtonRef.current = true;
                }}
                disabled={
                  isSubmitting ||
                  selectedVessel?.vessel_review_status === "IN_REVIEW"
                }
                className="px-7 py-3 bg-ocean-600 text-white font-bold rounded-xl flex items-center gap-2 hover:bg-ocean-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                  </>
                ) : mode === "edit" ? (
                  "Save changes"
                ) : (
                  "Post position"
                )}
              </button>
            )}
          </div>
        </form>
      </div>

      {showAddPort && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Submit a new port
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Arab ShipBroker assigns the trade zone during verification.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddPort(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  Port name <span className="text-red-400">*</span>
                </label>
                <input
                  value={addPortState.portName}
                  onChange={(e) =>
                    setAddPortState((s) => ({
                      ...s,
                      portName: e.target.value,
                    }))
                  }
                  placeholder="e.g. Bab el-Mandeb"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  Country <span className="text-red-400">*</span>
                </label>
                <input
                  value={addPortState.country}
                  onChange={(e) =>
                    setAddPortState((s) => ({
                      ...s,
                      country: e.target.value,
                    }))
                  }
                  placeholder="e.g. Yemen"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  Notes{" "}
                  <span className="text-xs font-normal text-slate-400">
                    (optional)
                  </span>
                </label>
                <input
                  value={addPortState.notes}
                  onChange={(e) =>
                    setAddPortState((s) => ({ ...s, notes: e.target.value }))
                  }
                  placeholder="e.g. Anchorage only, no berths"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all"
                />
              </div>

              <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-3">
                Port submitted. Will show as pending verification until Arab
                ShipBroker confirms it.
              </p>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddPort(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddPortSubmit}
                disabled={addPortSubmitting}
                className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-ocean-600 hover:bg-ocean-700 text-white rounded-xl transition-colors disabled:opacity-60"
              >
                {addPortSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Submit to Arab ShipBroker
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
