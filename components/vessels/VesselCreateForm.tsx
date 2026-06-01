"use client";
import { useRef, useState } from "react";
import {
  useForm,
  Controller,
  Resolver,
  FieldErrors,
  useFieldArray,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ship,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle,
  Info,
  Anchor,
  Building2,
  AlertTriangle,
  UserPlus,
  Trash2,
  Wrench,
  Leaf,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createVessel } from "@/sdk/app/vessels";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { ZONE_LABELS, ZONE_CODES, ZoneCode } from "@/lib/schemas/cargo";

const extendedVesselSchema = z.object({
  vessel_name: z.string().min(2, "Vessel name is required"),
  imo_number: z
    .string()
    .regex(/^\d{7}$/, "IMO must be exactly 7 digits")
    .optional()
    .or(z.literal("")),
  vessel_type: z.enum([
    "Bulk Carrier",
    "General Cargo",
    "MPP (Multi-Purpose)",
    "Break Bulk",
    "Geared Bulk",
    "Open Hatch",
    "Other",
  ]),
  dwt_grain: z.coerce.number().int().positive().optional(),
  dwt_bale: z.coerce.number().int().positive().optional(),
  grain_cbm: z.coerce.number().int().positive().optional(),
  bale_cbm: z.coerce.number().int().positive().optional(),
  build_year: z.coerce
    .number()
    .int()
    .min(1974)
    .max(new Date().getFullYear() + 1)
    .optional(),
  flag: z.string().optional(),
  is_geared: z.boolean().optional(),
  crane_count: z.coerce.number().int().positive().optional(),
  crane_swl_mt: z.coerce.number().positive().optional(),
  grain_certified: z.boolean().optional(),
  dg_certified: z.boolean().optional(),
  max_loa_m: z.coerce.number().positive().optional(),
  max_draft_m: z.coerce.number().positive().optional(),
  pi_club: z.string().optional(),
  owner_company: z.string().optional(),
  owner_country: z.string().optional(),
  manager_company: z.string().optional(),
  manager_country: z.string().optional(),
  notes: z.string().optional(),
  has_grabs: z.boolean().optional(),
  grab_capacity_mt: z.coerce.number().positive().optional(),
  has_co2_firefighting: z.boolean().optional(),
  hold_count: z.coerce.number().int().min(1).optional(),
  hatch_count: z.coerce.number().int().min(1).optional(),
  hatch_cover_type: z
    .enum([
      "Folding",
      "Single Pull",
      "Multi-Pull",
      "Pontoon",
      "Piggyback",
      "MacGregor",
      "Other",
    ])
    .optional(),
  hold_shape: z
    .enum(["Box-shaped", "Tweendeck", "Single deck", "Other"])
    .optional(),
  hatch_length_m: z.coerce.number().positive().optional(),
  hatch_width_m: z.coerce.number().positive().optional(),
  hold_length_m: z.coerce.number().positive().optional(),
  hold_width_m: z.coerce.number().positive().optional(),
  hold_depth_m: z.coerce.number().positive().optional(),
  eligible_logs: z.boolean().optional(),
  hold_special_notes: z.string().optional(),
  scrubber_fitted: z.boolean().optional(),
  scrubber_type: z.enum(["Open loop", "Closed loop", "Hybrid"]).optional(),
  eexi_attained: z.coerce.number().positive().optional(),
  cii_rating: z.enum(["A", "B", "C", "D", "E"]).optional(),
  cii_reference_year: z.coerce.number().int().optional(),
  owner_contact_name: z.string().optional(),
  owner_email: z.string().email("Invalid email").optional().or(z.literal("")),
  owner_phone: z.string().optional(),
  commercial_manager_company: z.string().optional(),
  commercial_manager_country: z.string().optional(),
  commercial_manager_contact: z.string().optional(),
  commercial_manager_email: z
    .string()
    .email("Invalid email")
    .optional()
    .or(z.literal("")),
  commercial_manager_phone: z.string().optional(),
  charter_status: z
    .enum([
      "Owner operated",
      "Time Charter (TC)",
      "Bareboat Charter (BBC)",
      "Management contract",
      "Other",
    ])
    .optional(),
  tc_charterer_name: z.string().optional(),
  tc_expiry: z.string().optional(),
  bbc_charterer_name: z.string().optional(),
  bbc_expiry: z.string().optional(),
  persons_in_charge: z
    .array(
      z.object({
        name: z.string().min(1, "Name is required"),
        role: z.enum([
          "Shipowner",
          "Commercial Manager",
          "Operator",
          "Broker",
          "Bareboat Charterer",
          "TC Charterer",
          "Other",
        ]),
        email: z.string().email("Invalid email").optional().or(z.literal("")),
        phone: z.string().optional(),
      }),
    )
    .optional(),
  pi_ig_member: z.boolean().optional(),
  pi_coverage_types: z.array(z.string()).optional(),
  pi_expiry_month: z.string().optional(),
  pi_expiry_year: z.coerce.number().int().optional(),
  war_risk_zones: z.array(z.string()).optional(),
  war_risk_trading: z
    .enum(["Yes", "No", "Subject to approval per voyage"])
    .optional(),
  war_risk_conditions: z.string().optional(),
  preferred_trading_areas: z.array(z.string()).optional(),
  preferred_zones: z.array(z.enum(ZONE_CODES)).optional(),
  gross_tonnage: z.coerce.number().int().positive().optional(),
  net_tonnage: z.coerce.number().int().positive().optional(),
});

type ExtendedVesselValues = z.infer<typeof extendedVesselSchema>;

const VESSEL_TYPES = [
  "Bulk Carrier",
  "General Cargo",
  "MPP (Multi-Purpose)",
  "Break Bulk",
  "Geared Bulk",
  "Open Hatch",
  "Other",
] as const;

const STEPS = [
  { id: "identity", label: "Identity", icon: Ship },
  { id: "technical", label: "Technical", icon: Anchor },
  { id: "cargo_holds", label: "Cargo Holds", icon: Wrench },
  { id: "environmental", label: "Environmental", icon: Leaf },
  { id: "ownership", label: "Ownership", icon: Building2 },
  { id: "review", label: "Review", icon: CheckCircle },
] as const;

const STEP_FIELDS: Record<number, (keyof ExtendedVesselValues)[]> = {
  0: ["vessel_name", "vessel_type"],
  1: ["dwt_grain"],
  2: [],
  3: [],
  4: [],
  5: [],
};

const FIELD_TO_STEP: Partial<Record<keyof ExtendedVesselValues, number>> = {
  vessel_name: 0,
  vessel_type: 0,
  imo_number: 0,
  flag: 0,
  dwt_grain: 1,
  dwt_bale: 1,
  grain_cbm: 1,
  bale_cbm: 1,
  build_year: 1,
  max_loa_m: 1,
  max_draft_m: 1,
  is_geared: 1,
  crane_count: 1,
  crane_swl_mt: 1,
  grain_certified: 1,
  dg_certified: 1,
  hold_count: 2,
  hatch_count: 2,
  scrubber_fitted: 3,
  owner_company: 4,
  owner_country: 4,
  manager_company: 4,
  manager_country: 4,
  pi_club: 4,
  preferred_zones: 4,
  notes: 4,
};

const parseOptionalNumber = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? undefined : numericValue;
};

function FieldLabel({
  children,
  hint,
  required,
}: {
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <label className="text-sm font-semibold text-slate-700">{children}</label>
      {required && <span className="text-red-400 text-xs">*</span>}
      {hint && (
        <span className="text-xs text-slate-400 font-normal">{hint}</span>
      )}
    </div>
  );
}

function FieldInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    error?: string;
    warning?: string;
  },
) {
  const { error, warning, className, ...rest } = props;
  return (
    <>
      <input
        {...rest}
        className={cn(
          "w-full h-10 px-3 rounded-xl border bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all",
          error
            ? "border-red-300 focus:ring-red-400"
            : warning
              ? "border-amber-300"
              : "border-slate-200",
          className,
        )}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {!error && warning && (
        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" /> {warning}
        </p>
      )}
    </>
  );
}

function FieldSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & {
    error?: string;
  },
) {
  const { error, className, children, ...rest } = props;
  return (
    <>
      <select
        {...rest}
        className={cn(
          "w-full h-10 px-3 rounded-xl border bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all cursor-pointer",
          error ? "border-red-300" : "border-slate-200",
          className,
        )}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </>
  );
}

function TriBoolean({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  hint?: string;
}) {
  const opts = [
    { label: "Yes", val: true },
    { label: "No", val: false },
    { label: "Unknown", val: undefined },
  ] as const;
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div className="flex gap-2">
        {opts.map((o) => (
          <button
            key={String(o.val)}
            type="button"
            onClick={() => onChange(o.val)}
            className={cn(
              "flex-1 h-9 rounded-xl text-sm font-semibold border transition-all",
              value === o.val
                ? "bg-ocean-600 text-white border-ocean-600"
                : "bg-slate-50 text-slate-600 border-slate-200 hover:border-ocean-300",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiSelectChips({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  const toggle = (opt: string) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
              value.includes(opt)
                ? "bg-ocean-600 text-white border-ocean-600"
                : "bg-slate-50 text-slate-600 border-slate-200 hover:border-ocean-300",
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex justify-between items-center px-4 py-2.5 text-sm">
      <span className="text-slate-500 font-medium">{label}</span>
      <span className="text-slate-900 font-semibold text-right break-word max-w-[60%]">
        {value}
      </span>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-ocean-600" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
        {title}
      </p>
      {children}
    </div>
  );
}

function getDwtWarning(val: number | undefined): string | undefined {
  if (!val) return undefined;
  if (val > 50000)
    return "Above 50,000 MT — may fall outside sub-15K DWT focus";
  return undefined;
}

function getYearWarning(val: number | undefined): {
  warning?: string;
  error?: string;
} {
  if (!val) return {};
  const currentYear = new Date().getFullYear();
  const age = currentYear - val;
  if (age > 50)
    return {
      error:
        "Vessel is over 50 years old — PSC restrictions likely. Contact Arab ShipBroker directly.",
    };
  if (age > 35)
    return {
      warning:
        "Older than 35 years — may face PSC restrictions. Confirm vessel is classed and trading.",
    };
  return {};
}

function getLoaWarning(val: number | undefined): string | undefined {
  if (!val) return undefined;
  if (val < 70 || val > 300) return "LOA outside expected range (70–300 m)";
  return undefined;
}

function getDraftWarning(val: number | undefined): string | undefined {
  if (!val) return undefined;
  if (val < 4 || val > 20) return "Draft outside expected range (4.0–20.0 m)";
  return undefined;
}

export function VesselCreateForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imoBypass, setImoBypass] = useState(false);
  const submitTriggeredByButtonRef = useRef(false);

  const form = useForm<ExtendedVesselValues>({
    resolver: zodResolver(
      extendedVesselSchema,
    ) as unknown as Resolver<ExtendedVesselValues>,
    defaultValues: {
      persons_in_charge: [],
      pi_coverage_types: [],
      war_risk_zones: [],
      preferred_trading_areas: [],
      // FIX 3: add to defaultValues so TypeScript can narrow the array type
      preferred_zones: [],
    },
    mode: "onChange",
  });

  const {
    fields: picFields,
    append: appendPic,
    remove: removePic,
  } = useFieldArray({
    control: form.control,
    name: "persons_in_charge",
  });

  const values = form.watch();
  const errors = form.formState.errors;

  const navigate = (nextStep: number) => {
    setDirection(nextStep > step ? 1 : -1);
    setStep(nextStep);
  };

  const goNext = async () => {
    const fields = STEP_FIELDS[step];
    if (fields.length > 0) {
      const valid = await form.trigger(
        fields as (keyof ExtendedVesselValues)[],
      );
      if (!valid) return;
    }
    navigate(Math.min(step + 1, STEPS.length - 1));
  };

  const goBack = () => navigate(Math.max(step - 1, 0));

  // ── FIX 4: pass grain_cbm, bale_cbm, preferred_zones to createVessel ─────────
  const onSubmit = async (data: ExtendedVesselValues) => {
    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { id } = await createVessel(supabase, {
        vessel_name: data.vessel_name,
        imo_number: data.imo_number,
        vessel_type: data.vessel_type as
          | "Bulk Carrier"
          | "General Cargo"
          | "Other",
        dwt_grain: data.dwt_grain,
        dwt_bale: data.dwt_bale,
        grain_cbm: data.grain_cbm,
        bale_cbm: data.bale_cbm,
        build_year: data.build_year,
        flag: data.flag,
        is_geared: data.is_geared,
        crane_count: data.crane_count,
        crane_swl_mt: data.crane_swl_mt,
        grain_certified: data.grain_certified,
        dg_certified: data.dg_certified,
        max_loa_m: data.max_loa_m,
        max_draft_m: data.max_draft_m,
        pi_club: data.pi_club,
        owner_company: data.owner_company,
        owner_country: data.owner_country,
        manager_company: data.manager_company,
        manager_country: data.manager_country,
        commercial_manager_company: data.commercial_manager_company,
        commercial_manager_country: data.commercial_manager_country,
        commercial_manager_contact: data.commercial_manager_contact,
        commercial_manager_email: data.commercial_manager_email,
        commercial_manager_phone: data.commercial_manager_phone,
        charter_status: data.charter_status,
        tc_charterer_name: data.tc_charterer_name,
        tc_expiry: data.tc_expiry,
        bbc_charterer_name: data.bbc_charterer_name,
        bbc_expiry: data.bbc_expiry,
        persons_in_charge: data.persons_in_charge,
        pi_ig_member: data.pi_ig_member,
        pi_coverage_types: data.pi_coverage_types,
        war_risk_trading: data.war_risk_trading,
        war_risk_conditions: data.war_risk_conditions,
        preferred_trading_areas: data.preferred_trading_areas,
        preferred_zones: data.preferred_zones,
        notes: data.notes,
      });
      toast.success(
        "Your position has been submitted to Arab ShipBroker. Once reviewed, it will be published on the tonnage board.",
      );
      router.push(`/dashboard/vessels/${id}`);
      router.refresh();
    } catch (err) {
      const formattedError = (() => {
        if (err instanceof Error && err.message) return err.message;
        if (typeof err === "object" && err !== null) {
          const candidate = err as {
            message?: string;
            details?: string;
            hint?: string;
          };
          const parts = [candidate.message, candidate.details, candidate.hint]
            .filter((part): part is string => Boolean(part && part.trim()))
            .map((part) => part.trim());
          if (parts.length > 0) return parts.join(" ");
        }
        return "Something went wrong. Please try again.";
      })();
      toast.error(formattedError);
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

  const onSubmitError = (submitErrors: FieldErrors<ExtendedVesselValues>) => {
    const [firstErrorField] = Object.keys(submitErrors) as Array<
      keyof ExtendedVesselValues
    >;
    if (!firstErrorField) {
      toast.error("Please review the form and try again.");
      return;
    }
    const firstErrorStep = FIELD_TO_STEP[firstErrorField];
    if (typeof firstErrorStep === "number" && firstErrorStep !== step) {
      navigate(firstErrorStep);
    }
    const firstErrorMessage = submitErrors[firstErrorField]?.message;
    toast.error(
      typeof firstErrorMessage === "string"
        ? firstErrorMessage
        : "Please fix the highlighted fields and try again.",
    );
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (!submitTriggeredByButtonRef.current) {
      event.preventDefault();
      return;
    }
    submitTriggeredByButtonRef.current = false;
    void form.handleSubmit(onSubmit, onSubmitError)(event);
  };

  return (
    <div className="max-w-3xl mx-auto max-[768px]:px-4">
      <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-1">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={s.id}
              className="flex items-center flex-1 last:flex-none shrink-0"
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
                  idx === step && "bg-ocean-600 text-white",
                  idx < step && "bg-ocean-100 text-ocean-700",
                  idx > step && "text-slate-400",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-1 rounded-full transition-colors min-w-2",
                    idx < step ? "bg-ocean-400" : "bg-slate-100",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-[768px]:p-6 overflow-hidden">
        <form onSubmit={handleFormSubmit} onKeyDown={preventEnterSubmit}>
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: d * 30 }),
                center: { opacity: 1, x: 0 },
                exit: (d: number) => ({ opacity: 0, x: d * -30 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {step === 0 && (
                <div className="space-y-5">
                  <SectionHeader
                    icon={Ship}
                    title="Vessel identity"
                    subtitle="Core identification information."
                  />
                  <div>
                    <FieldLabel required>Vessel name</FieldLabel>
                    <FieldInput
                      {...form.register("vessel_name")}
                      placeholder="e.g. MV Arabian Star"
                      error={errors.vessel_name?.message}
                    />
                  </div>
                  <div>
                    <FieldLabel required>Vessel type</FieldLabel>
                    <Controller
                      control={form.control}
                      name="vessel_type"
                      render={({ field }) => (
                        <FieldSelect
                          {...field}
                          value={field.value ?? ""}
                          error={errors.vessel_type?.message}
                        >
                          <option value="" disabled>
                            Select type…
                          </option>
                          {VESSEL_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </FieldSelect>
                      )}
                    />
                    {values.vessel_type === "MPP (Multi-Purpose)" && (
                      <p className="text-xs text-blue-600 mt-1.5 flex items-center gap-1">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        MPP vessels match both Dry Bulk and Break Bulk cargo
                        listings.
                      </p>
                    )}
                  </div>
                  <div>
                    <FieldLabel hint="Required — IMO is the vessel's unique identifier for matchmaking, tracking and sanctions screening.">
                      IMO number
                    </FieldLabel>
                    <FieldInput
                      {...form.register("imo_number")}
                      placeholder="e.g. 9123456"
                      maxLength={7}
                      error={errors.imo_number?.message}
                    />
                    {!values.imo_number && !imoBypass && (
                      <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs text-amber-800 font-medium">
                            IMO is strongly recommended.
                          </p>
                          <p className="text-xs text-amber-700 mt-0.5">
                            Without it, this vessel cannot be matched or
                            verified.{" "}
                            <button
                              type="button"
                              onClick={() => setImoBypass(true)}
                              className="underline font-semibold hover:text-amber-900"
                            >
                              Continue without IMO
                            </button>{" "}
                            (you can add it later).
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <FieldLabel>Flag state</FieldLabel>
                    <FieldInput
                      {...form.register("flag")}
                      placeholder="e.g. Panama"
                    />
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
                    <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 leading-relaxed">
                      Arab ShipBroker will verify your vessel and assign a trust
                      level based on daily traffic. Your vessel is available for
                      posting positions immediately with default settings.
                    </p>
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════
                  STEP 1 — Technical specifications
              ══════════════════════════════════════════════════════ */}
              {step === 1 && (
                <div className="space-y-6">
                  <SectionHeader
                    icon={Anchor}
                    title="Technical specifications"
                    subtitle="These drive matchmaking accuracy."
                  />
                  <FormSection title="Capacity">
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel hint="(MT, matchmaking primary)" required>
                          DWT Grain
                        </FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("dwt_grain", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 28000"
                          error={errors.dwt_grain?.message}
                          warning={getDwtWarning(values.dwt_grain)}
                        />
                      </div>
                      <div>
                        <FieldLabel hint="(MT)" required>
                          DWT Bale
                        </FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("dwt_bale", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 27000"
                          error={errors.dwt_bale?.message}
                        />
                        {values.dwt_bale &&
                          values.dwt_grain &&
                          values.dwt_bale > values.dwt_grain && (
                            <p className="text-xs text-red-500 mt-1">
                              DWT Bale cannot exceed DWT Grain.
                            </p>
                          )}
                      </div>
                    </div>
                  </FormSection>

                  {/* ── Cubic capacity (grain_cbm / bale_cbm) ── */}
                  <FormSection title="Cubic capacity (optional)">
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                      Enter the grain and/or bale cubic capacity of all holds
                      combined. This is used to verify cargo volume fits: Volume
                      (cbm) = Qty (MT) × Stowage Factor.
                    </p>
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel hint="(cbm / m³)">
                          Grain capacity
                        </FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("grain_cbm", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 38 500"
                          error={errors.grain_cbm?.message}
                        />
                        {values.grain_cbm && values.dwt_grain && (
                          <p className="text-xs text-slate-400 mt-1">
                            Implied SF:{" "}
                            <strong className="text-slate-600">
                              {(values.grain_cbm / values.dwt_grain).toFixed(2)}{" "}
                              m³/t
                            </strong>
                          </p>
                        )}
                      </div>
                      <div>
                        <FieldLabel hint="(cbm / m³)">Bale capacity</FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("bale_cbm", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 36 800"
                          error={errors.bale_cbm?.message}
                        />
                        {values.bale_cbm &&
                          values.grain_cbm &&
                          values.bale_cbm > values.grain_cbm && (
                            <p className="text-xs text-red-500 mt-1">
                              Bale capacity cannot exceed grain capacity.
                            </p>
                          )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      1 cbm = 35.31 cbft. Enter in cubic metres (cbm).
                    </p>
                  </FormSection>

                  <FormSection title="Dimensions">
                    <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel required>Built year</FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("build_year", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 2008"
                          min={1974}
                          max={new Date().getFullYear() + 1}
                          error={
                            getYearWarning(values.build_year).error ||
                            errors.build_year?.message
                          }
                          warning={getYearWarning(values.build_year).warning}
                        />
                      </div>
                      <div>
                        <FieldLabel hint="(m)" required>
                          LOA
                        </FieldLabel>
                        <FieldInput
                          type="number"
                          step="0.01"
                          {...form.register("max_loa_m", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 189.5"
                          error={errors.max_loa_m?.message}
                          warning={getLoaWarning(values.max_loa_m)}
                        />
                      </div>
                      <div>
                        <FieldLabel hint="(m)" required>
                          Draft — Summer
                        </FieldLabel>
                        <FieldInput
                          type="number"
                          step="0.01"
                          {...form.register("max_draft_m", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 10.2"
                          error={errors.max_draft_m?.message}
                          warning={getDraftWarning(values.max_draft_m)}
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection title="Tonnage (optional)">
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel>Gross Tonnage (GT)</FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("gross_tonnage", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 16800"
                        />
                      </div>
                      <div>
                        <FieldLabel>Net Tonnage (NT)</FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("net_tonnage", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 9200"
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection title="Certifications & Equipment">
                    <div className="space-y-4">
                      <Controller
                        control={form.control}
                        name="is_geared"
                        render={({ field }) => (
                          <TriBoolean
                            label="Geared (vessel has own cranes)"
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                      {values.is_geared === true && (
                        <div className="pl-4 border-l-2 border-ocean-200 space-y-4">
                          <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                            <div>
                              <FieldLabel>Crane count</FieldLabel>
                              <FieldInput
                                type="number"
                                {...form.register("crane_count", {
                                  setValueAs: parseOptionalNumber,
                                })}
                                placeholder="e.g. 4"
                              />
                            </div>
                            <div>
                              <FieldLabel hint="(MT)">Crane SWL</FieldLabel>
                              <FieldInput
                                type="number"
                                step="0.5"
                                {...form.register("crane_swl_mt", {
                                  setValueAs: parseOptionalNumber,
                                })}
                                placeholder="e.g. 25"
                              />
                            </div>
                          </div>
                          <Controller
                            control={form.control}
                            name="has_grabs"
                            render={({ field }) => (
                              <TriBoolean
                                label="Does the vessel have grabs?"
                                value={field.value}
                                onChange={field.onChange}
                              />
                            )}
                          />
                          {values.has_grabs === true && (
                            <div className="pl-4 border-l-2 border-ocean-100">
                              <FieldLabel hint="(MT)">Grab capacity</FieldLabel>
                              <FieldInput
                                type="number"
                                step="0.5"
                                {...form.register("grab_capacity_mt", {
                                  setValueAs: parseOptionalNumber,
                                })}
                                placeholder="e.g. 12"
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <Controller
                        control={form.control}
                        name="grain_certified"
                        render={({ field }) => (
                          <TriBoolean
                            label="Grain certified"
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                      <Controller
                        control={form.control}
                        name="dg_certified"
                        render={({ field }) => (
                          <TriBoolean
                            label="DG certified (dangerous goods)"
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                      {values.dg_certified === true && (
                        <div className="pl-4 border-l-2 border-red-200">
                          <Controller
                            control={form.control}
                            name="has_co2_firefighting"
                            render={({ field }) => (
                              <TriBoolean
                                label="Is the cargo hold fitted with a fixed CO₂ firefighting system?"
                                hint="Required for DG cargo vetting"
                                value={field.value}
                                onChange={field.onChange}
                              />
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </FormSection>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════
                  STEP 2 — Cargo hold details
              ══════════════════════════════════════════════════════ */}
              {step === 2 && (
                <div className="space-y-6">
                  <SectionHeader
                    icon={Wrench}
                    title="Cargo hold details"
                    subtitle="Critical for break bulk matching and cargo compatibility."
                  />
                  <FormSection title="Hold configuration">
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel required>Number of cargo holds</FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("hold_count", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 5"
                          min={1}
                        />
                      </div>
                      <div>
                        <FieldLabel>Number of hatches</FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("hatch_count", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 5"
                          min={1}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel>Hatch cover type</FieldLabel>
                        <Controller
                          control={form.control}
                          name="hatch_cover_type"
                          render={({ field }) => (
                            <FieldSelect {...field} value={field.value ?? ""}>
                              <option value="">Not specified</option>
                              {[
                                "Folding",
                                "Single Pull",
                                "Multi-Pull",
                                "Pontoon",
                                "Piggyback",
                                "MacGregor",
                                "Other",
                              ].map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </FieldSelect>
                          )}
                        />
                      </div>
                      <div>
                        <FieldLabel>Hold shape</FieldLabel>
                        <Controller
                          control={form.control}
                          name="hold_shape"
                          render={({ field }) => (
                            <FieldSelect {...field} value={field.value ?? ""}>
                              <option value="">Not specified</option>
                              {[
                                "Box-shaped",
                                "Tweendeck",
                                "Single deck",
                                "Other",
                              ].map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </FieldSelect>
                          )}
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection title="Hatch dimensions (average for 3+ holds)">
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel hint="(m)">Hatch length</FieldLabel>
                        <FieldInput
                          type="number"
                          step="0.1"
                          {...form.register("hatch_length_m", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 18.5"
                        />
                      </div>
                      <div>
                        <FieldLabel hint="(m)">Hatch width</FieldLabel>
                        <FieldInput
                          type="number"
                          step="0.1"
                          {...form.register("hatch_width_m", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 14.0"
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection title="Hold dimensions">
                    <div className="grid grid-cols-3 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel hint="(m)">Length</FieldLabel>
                        <FieldInput
                          type="number"
                          step="0.1"
                          {...form.register("hold_length_m", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 22.0"
                        />
                      </div>
                      <div>
                        <FieldLabel hint="(m)">Width</FieldLabel>
                        <FieldInput
                          type="number"
                          step="0.1"
                          {...form.register("hold_width_m", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 18.0"
                        />
                      </div>
                      <div>
                        <FieldLabel hint="(m)">Depth</FieldLabel>
                        <FieldInput
                          type="number"
                          step="0.1"
                          {...form.register("hold_depth_m", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 12.5"
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection title="Special cargo eligibility">
                    <Controller
                      control={form.control}
                      name="eligible_logs"
                      render={({ field }) => (
                        <TriBoolean
                          label="Eligible to carry logs"
                          hint="Specific structural requirement"
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    <div className="mt-4">
                      <FieldLabel>Special features or restrictions</FieldLabel>
                      <textarea
                        {...form.register("hold_special_notes")}
                        rows={2}
                        placeholder="Any special cargo hold features or loading restrictions…"
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all resize-none"
                      />
                    </div>
                  </FormSection>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════
                  STEP 3 — Environmental & regulatory
              ══════════════════════════════════════════════════════ */}
              {step === 3 && (
                <div className="space-y-6">
                  <SectionHeader
                    icon={Leaf}
                    title="Environmental & regulatory"
                    subtitle="Collected now for future compliance matching."
                  />
                  <FormSection title="Exhaust Gas Cleaning System (EGCS / Scrubber)">
                    <Controller
                      control={form.control}
                      name="scrubber_fitted"
                      render={({ field }) => (
                        <TriBoolean
                          label="Scrubber fitted?"
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    {values.scrubber_fitted === true && (
                      <div className="mt-4 pl-4 border-l-2 border-ocean-200 space-y-3">
                        <div>
                          <FieldLabel>Scrubber type</FieldLabel>
                          <Controller
                            control={form.control}
                            name="scrubber_type"
                            render={({ field }) => (
                              <FieldSelect {...field} value={field.value ?? ""}>
                                <option value="">Select type…</option>
                                {["Open loop", "Closed loop", "Hybrid"].map(
                                  (t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ),
                                )}
                              </FieldSelect>
                            )}
                          />
                        </div>
                        {values.scrubber_type === "Open loop" && (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800">
                              Open loop scrubbers are prohibited in several
                              ports including Egypt, Saudi Arabia and UAE. This
                              affects cargo matching.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </FormSection>

                  <FormSection title="EEXI / CII (optional)">
                    <div className="grid grid-cols-3 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel hint="(W/tonne-nm)">
                          EEXI attained
                        </FieldLabel>
                        <FieldInput
                          type="number"
                          step="0.01"
                          {...form.register("eexi_attained", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 4.5"
                        />
                      </div>
                      <div>
                        <FieldLabel>CII rating</FieldLabel>
                        <Controller
                          control={form.control}
                          name="cii_rating"
                          render={({ field }) => (
                            <FieldSelect {...field} value={field.value ?? ""}>
                              <option value="">Not specified</option>
                              {["A", "B", "C", "D", "E"].map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </FieldSelect>
                          )}
                        />
                      </div>
                      <div>
                        <FieldLabel>CII reference year</FieldLabel>
                        <FieldInput
                          type="number"
                          {...form.register("cii_reference_year", {
                            setValueAs: parseOptionalNumber,
                          })}
                          placeholder="e.g. 2023"
                          min={2023}
                          max={new Date().getFullYear()}
                        />
                      </div>
                    </div>
                  </FormSection>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════
                  STEP 4 — Ownership & commercial
              ══════════════════════════════════════════════════════ */}
              {step === 4 && (
                <div className="space-y-6">
                  <SectionHeader
                    icon={Building2}
                    title="Ownership & commercial"
                    subtitle="Helps Arab ShipBroker verify the vessel and determine commercial authority."
                  />

                  <FormSection title="Registered owner">
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel>Owner company</FieldLabel>
                        <FieldInput
                          {...form.register("owner_company")}
                          placeholder="e.g. Gulf Maritime LLC"
                        />
                      </div>
                      <div>
                        <FieldLabel>Country</FieldLabel>
                        <FieldInput
                          {...form.register("owner_country")}
                          placeholder="e.g. UAE"
                        />
                      </div>
                      <div>
                        <FieldLabel>Contact person</FieldLabel>
                        <FieldInput
                          {...form.register("owner_contact_name")}
                          placeholder="e.g. Ahmed Al-Rashid"
                        />
                      </div>
                      <div>
                        <FieldLabel>Email</FieldLabel>
                        <FieldInput
                          type="email"
                          {...form.register("owner_email")}
                          placeholder="e.g. chartering@gulfmaritime.ae"
                          error={errors.owner_email?.message}
                        />
                      </div>
                      <div className="col-span-2 max-[768px]:col-span-1">
                        <FieldLabel>Phone</FieldLabel>
                        <FieldInput
                          {...form.register("owner_phone")}
                          placeholder="e.g. +971 4 000 0000"
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection title="Commercial manager (if different from owner)">
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel>Company</FieldLabel>
                        <FieldInput
                          {...form.register("commercial_manager_company")}
                          placeholder="e.g. Orient Chartering"
                        />
                      </div>
                      <div>
                        <FieldLabel>Country</FieldLabel>
                        <FieldInput
                          {...form.register("commercial_manager_country")}
                          placeholder="e.g. Egypt"
                        />
                      </div>
                      {values.commercial_manager_company && (
                        <>
                          <div>
                            <FieldLabel>Contact person</FieldLabel>
                            <FieldInput
                              {...form.register("commercial_manager_contact")}
                              placeholder="e.g. Mohamed Hassan"
                            />
                          </div>
                          <div>
                            <FieldLabel>Email</FieldLabel>
                            <FieldInput
                              type="email"
                              {...form.register("commercial_manager_email")}
                              placeholder="e.g. ops@orientchartering.com"
                              error={errors.commercial_manager_email?.message}
                            />
                          </div>
                          <div>
                            <FieldLabel>Phone</FieldLabel>
                            <FieldInput
                              {...form.register("commercial_manager_phone")}
                              placeholder="e.g. +20 2 0000 0000"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </FormSection>

                  <FormSection title="Technical manager">
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4">
                      <div>
                        <FieldLabel>Company</FieldLabel>
                        <FieldInput
                          {...form.register("manager_company")}
                          placeholder="e.g. Orient Ship Management"
                        />
                      </div>
                      <div>
                        <FieldLabel>Country</FieldLabel>
                        <FieldInput
                          {...form.register("manager_country")}
                          placeholder="e.g. Egypt"
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection title="Charter status">
                    <div>
                      <FieldLabel>Charter arrangement</FieldLabel>
                      <Controller
                        control={form.control}
                        name="charter_status"
                        render={({ field }) => (
                          <FieldSelect {...field} value={field.value ?? ""}>
                            <option value="">Not specified</option>
                            {[
                              "Owner operated",
                              "Time Charter (TC)",
                              "Bareboat Charter (BBC)",
                              "Management contract",
                              "Other",
                            ].map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </FieldSelect>
                        )}
                      />
                      <p className="text-xs text-slate-400 mt-1.5">
                        Determines who holds commercial authority — brokers need
                        this before presenting the vessel.
                      </p>
                    </div>
                    {values.charter_status === "Time Charter (TC)" && (
                      <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4 pl-4 border-l-2 border-ocean-200">
                        <div>
                          <FieldLabel>TC charterer name</FieldLabel>
                          <FieldInput
                            {...form.register("tc_charterer_name")}
                            placeholder="e.g. Global Bulk Ltd"
                          />
                        </div>
                        <div>
                          <FieldLabel hint="(optional)">TC expiry</FieldLabel>
                          <FieldInput
                            type="date"
                            {...form.register("tc_expiry")}
                          />
                        </div>
                      </div>
                    )}
                    {values.charter_status === "Bareboat Charter (BBC)" && (
                      <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-4 pl-4 border-l-2 border-ocean-200">
                        <div>
                          <FieldLabel>BBC charterer name</FieldLabel>
                          <FieldInput
                            {...form.register("bbc_charterer_name")}
                            placeholder="e.g. Nile Navigation Co."
                          />
                        </div>
                        <div>
                          <FieldLabel hint="(optional)">BBC expiry</FieldLabel>
                          <FieldInput
                            type="date"
                            {...form.register("bbc_expiry")}
                          />
                        </div>
                      </div>
                    )}
                  </FormSection>

                  <FormSection title="Persons in charge (who can fix this vessel)">
                    <div className="space-y-3">
                      {picFields.map((pic, idx) => (
                        <div
                          key={pic.id}
                          className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                              Contact {idx + 1}
                            </p>
                            <button
                              type="button"
                              onClick={() => removePic(idx)}
                              className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-3">
                            <div>
                              <FieldLabel required>Name</FieldLabel>
                              <FieldInput
                                {...form.register(
                                  `persons_in_charge.${idx}.name`,
                                )}
                                placeholder="Full name"
                                error={
                                  errors.persons_in_charge?.[idx]?.name?.message
                                }
                              />
                            </div>
                            <div>
                              <FieldLabel>Role</FieldLabel>
                              <Controller
                                control={form.control}
                                name={`persons_in_charge.${idx}.role`}
                                render={({ field }) => (
                                  <FieldSelect
                                    {...field}
                                    value={field.value ?? ""}
                                  >
                                    {[
                                      "Shipowner",
                                      "Commercial Manager",
                                      "Operator",
                                      "Broker",
                                      "Bareboat Charterer",
                                      "TC Charterer",
                                      "Other",
                                    ].map((r) => (
                                      <option key={r} value={r}>
                                        {r}
                                      </option>
                                    ))}
                                  </FieldSelect>
                                )}
                              />
                            </div>
                            <div>
                              <FieldLabel>Email</FieldLabel>
                              <FieldInput
                                type="email"
                                {...form.register(
                                  `persons_in_charge.${idx}.email`,
                                )}
                                placeholder="e.g. contact@company.com"
                                error={
                                  errors.persons_in_charge?.[idx]?.email
                                    ?.message
                                }
                              />
                            </div>
                            <div>
                              <FieldLabel>Phone</FieldLabel>
                              <FieldInput
                                {...form.register(
                                  `persons_in_charge.${idx}.phone`,
                                )}
                                placeholder="e.g. +971 50 000 0000"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                      {picFields.length < 3 && (
                        <button
                          type="button"
                          onClick={() =>
                            appendPic({
                              name: "",
                              role: "Shipowner",
                              email: "",
                              phone: "",
                            })
                          }
                          className="flex items-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-ocean-300 text-sm font-semibold text-slate-500 hover:text-ocean-600 transition-all"
                        >
                          <UserPlus className="w-4 h-4" />
                          Add person in charge
                        </button>
                      )}
                      {picFields.length === 0 && (
                        <p className="text-xs text-slate-400 text-center">
                          At least one contact is recommended.
                        </p>
                      )}
                    </div>
                  </FormSection>

                  <FormSection title="P&I Insurance">
                    <div className="space-y-4">
                      <div>
                        <FieldLabel>P&I Club name</FieldLabel>
                        <FieldInput
                          {...form.register("pi_club")}
                          placeholder="e.g. UK P&I Club"
                        />
                      </div>
                      <Controller
                        control={form.control}
                        name="pi_ig_member"
                        render={({ field }) => (
                          <TriBoolean
                            label="International Group member?"
                            hint="IG clubs pool cover to $3.1bn — charterers routinely ask"
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                      <Controller
                        control={form.control}
                        name="pi_coverage_types"
                        render={({ field }) => (
                          <MultiSelectChips
                            label="Coverage type"
                            options={[
                              "Standard P&I",
                              "FD&D",
                              "War Risk P&I extension",
                              "H&M",
                              "Loss of Hire",
                            ]}
                            value={field.value ?? []}
                            onChange={field.onChange}
                          />
                        )}
                      />
                      {(values.pi_coverage_types ?? []).includes(
                        "War Risk P&I extension",
                      ) && (
                        <div className="pl-4 border-l-2 border-amber-200 space-y-3">
                          <Controller
                            control={form.control}
                            name="war_risk_zones"
                            render={({ field }) => (
                              <MultiSelectChips
                                label="War risk zones covered"
                                options={[
                                  "Red Sea/Gulf of Aden",
                                  "Arabian Gulf/Hormuz",
                                  "Black Sea/Ukraine",
                                  "Other",
                                ]}
                                value={field.value ?? []}
                                onChange={field.onChange}
                              />
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </FormSection>

                  <FormSection title="Preferred trading areas">
                    <Controller
                      control={form.control}
                      name="preferred_trading_areas"
                      render={({ field }) => (
                        <MultiSelectChips
                          label=""
                          hint="No selection = worldwide"
                          options={[
                            "Mediterranean",
                            "Black Sea/Sea of Azov",
                            "Red Sea",
                            "Arabian Gulf",
                            "Arabian Sea",
                            "East Africa",
                            "West Africa",
                            "Indian Subcontinent",
                            "UK Continent",
                            "Baltic",
                            "Far East",
                            "Southeast Asia",
                            "East Coast South America",
                            "Worldwide",
                          ]}
                          value={field.value ?? []}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    <p className="text-xs text-slate-400 mt-2">
                      Selection affects match ranking, not hard-blocking.
                    </p>
                  </FormSection>

                  {/* ── Preferred destination zones (preferred_zones) ── */}
                  <FormSection title="Preferred destination zones">
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                      Select the geographic zones this vessel prefers to
                      discharge in. Linked directly to the system zone list —
                      enables automatic suggestions and zone-aware cargo
                      filtering. Leave empty for worldwide / no preference.
                    </p>
                    <Controller
                      control={form.control}
                      name="preferred_zones"
                      render={({ field }) => {
                        // After adding preferred_zones to the schema,
                        // field.value is now correctly typed as ZoneCode[]
                        const selected: ZoneCode[] = field.value ?? [];
                        const toggle = (code: ZoneCode) => {
                          field.onChange(
                            selected.includes(code)
                              ? selected.filter((z) => z !== code)
                              : [...selected, code],
                          );
                        };
                        return (
                          <div className="flex flex-wrap gap-2">
                            {(
                              ZONE_CODES.filter(
                                (z) => z !== "Unknown",
                              ) as ZoneCode[]
                            ).map((code) => {
                              const active = selected.includes(code);
                              return (
                                <button
                                  key={code}
                                  type="button"
                                  onClick={() => toggle(code)}
                                  className={cn(
                                    "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all",
                                    active
                                      ? "bg-ocean-600 text-white border-ocean-600"
                                      : "bg-white text-slate-600 border-slate-200 hover:border-ocean-300 hover:text-ocean-700",
                                  )}
                                >
                                  {ZONE_LABELS[code]}
                                  <span className="ml-1.5 opacity-60 font-normal">
                                    {code}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    {(values.preferred_zones ?? []).length > 0 && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <span>Selected:</span>
                        <span className="font-semibold text-ocean-700">
                          {(values.preferred_zones ?? [])
                            .map((z) => ZONE_LABELS[z])
                            .join(", ")}
                        </span>
                        <button
                          type="button"
                          className="ml-auto text-xs text-slate-400 hover:text-red-500 font-semibold"
                          onClick={() => form.setValue("preferred_zones", [])}
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-slate-400 mt-2">
                      Affects match ranking (soft preference — not a hard
                      filter).
                    </p>
                  </FormSection>

                  <FormSection title="War risk zone trading">
                    <div>
                      <FieldLabel>
                        Does this vessel trade in or accept war risk zones?
                      </FieldLabel>
                      <Controller
                        control={form.control}
                        name="war_risk_trading"
                        render={({ field }) => (
                          <FieldSelect {...field} value={field.value ?? ""}>
                            <option value="">Not specified</option>
                            {[
                              "Yes",
                              "No",
                              "Subject to approval per voyage",
                            ].map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </FieldSelect>
                        )}
                      />
                    </div>
                    {(values.war_risk_trading === "Yes" ||
                      values.war_risk_trading ===
                        "Subject to approval per voyage") && (
                      <div>
                        <FieldLabel>
                          Specific zone conditions (optional)
                        </FieldLabel>
                        <textarea
                          {...form.register("war_risk_conditions")}
                          rows={2}
                          placeholder="e.g. Red Sea approved subject to war risk premium. Black Sea case by case."
                          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all resize-none"
                        />
                      </div>
                    )}
                  </FormSection>

                  <FormSection title="Additional notes">
                    <textarea
                      {...form.register("notes")}
                      rows={3}
                      placeholder="Any relevant information about the vessel…"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all resize-none"
                    />
                  </FormSection>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════
                  STEP 5 — Review & register
              ══════════════════════════════════════════════════════ */}
              {step === 5 && (
                <div className="space-y-5">
                  <SectionHeader
                    icon={CheckCircle}
                    title="Review & register"
                    subtitle="Confirm the details below. You can update them after registration."
                  />
                  <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200">
                    <ReviewRow
                      label="Vessel name"
                      value={values.vessel_name ?? "—"}
                    />
                    <ReviewRow
                      label="IMO number"
                      value={values.imo_number || "Not provided"}
                    />
                    <ReviewRow
                      label="Vessel type"
                      value={values.vessel_type ?? "—"}
                    />
                    <ReviewRow label="Flag" value={values.flag ?? "—"} />
                    <ReviewRow
                      label="Built year"
                      value={
                        values.build_year ? String(values.build_year) : "—"
                      }
                    />
                    <ReviewRow
                      label="DWT (grain)"
                      value={
                        values.dwt_grain
                          ? `${values.dwt_grain.toLocaleString()} MT`
                          : "—"
                      }
                    />
                    <ReviewRow
                      label="DWT (bale)"
                      value={
                        values.dwt_bale
                          ? `${values.dwt_bale.toLocaleString()} MT`
                          : "—"
                      }
                    />
                    {values.grain_cbm && (
                      <ReviewRow
                        label="Grain capacity"
                        value={`${values.grain_cbm.toLocaleString()} cbm`}
                      />
                    )}
                    {values.bale_cbm && (
                      <ReviewRow
                        label="Bale capacity"
                        value={`${values.bale_cbm.toLocaleString()} cbm`}
                      />
                    )}
                    <ReviewRow
                      label="LOA"
                      value={values.max_loa_m ? `${values.max_loa_m} m` : "—"}
                    />
                    <ReviewRow
                      label="Draft — Summer"
                      value={
                        values.max_draft_m ? `${values.max_draft_m} m` : "—"
                      }
                    />
                    <ReviewRow
                      label="Geared"
                      value={
                        values.is_geared === undefined
                          ? "—"
                          : values.is_geared
                            ? "Yes"
                            : "No"
                      }
                    />
                    <ReviewRow
                      label="Grain certified"
                      value={
                        values.grain_certified === undefined
                          ? "—"
                          : values.grain_certified
                            ? "Yes"
                            : "No"
                      }
                    />
                    <ReviewRow
                      label="DG certified"
                      value={
                        values.dg_certified === undefined
                          ? "—"
                          : values.dg_certified
                            ? "Yes"
                            : "No"
                      }
                    />
                    <ReviewRow
                      label="Owner"
                      value={values.owner_company ?? "—"}
                    />
                    <ReviewRow
                      label="Charter status"
                      value={values.charter_status ?? "—"}
                    />
                    {(values.preferred_zones ?? []).length > 0 && (
                      <ReviewRow
                        label="Preferred zones"
                        value={(values.preferred_zones ?? [])
                          .map((z) => ZONE_LABELS[z])
                          .join(", ")}
                      />
                    )}
                    {(values.persons_in_charge ?? []).length > 0 && (
                      <ReviewRow
                        label="Contacts"
                        value={(values.persons_in_charge ?? [])
                          .map((p) => `${p.name} (${p.role})`)
                          .join(", ")}
                      />
                    )}
                  </div>

                  <div className="bg-ocean-50 border border-ocean-200 rounded-xl p-4 flex gap-3">
                    <Anchor className="w-4 h-4 text-ocean-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-ocean-800">
                      <p className="font-semibold">What happens next</p>
                      <p className="mt-1 leading-relaxed">
                        Arab ShipBroker will verify your vessel and assign a
                        trust level based on daily traffic. Your vessel is
                        available for posting positions immediately with default
                        settings.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* ── Navigation buttons ────────────────────────────────── */}
          <div className="flex justify-between items-center pt-8 mt-6 border-t border-slate-100">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0}
              className="px-5 py-2.5 font-semibold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors disabled:invisible flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={step === 0 && !values.imo_number && !imoBypass}
                className="px-7 py-3 bg-ocean-600 text-white font-bold rounded-xl flex items-center gap-2 hover:bg-ocean-700 transition-colors disabled:opacity-50"
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
                className="px-7 py-3 bg-ocean-600 text-white font-bold rounded-xl flex items-center gap-2 hover:bg-ocean-700 transition-colors disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Registering…
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" /> Register vessel
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
