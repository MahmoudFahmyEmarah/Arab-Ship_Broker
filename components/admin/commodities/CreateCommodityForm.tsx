"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { createCommodity } from "@/app/(admin)/admin/commodities/actions";
import { cn } from "@/lib/utils";

const CARGO_TYPES = ["Dry Bulk", "Break Bulk"] as const;
const IMSBC_CATS = ["Cat_A", "Cat_B", "Cat_C", "DG", "Non_DG"] as const;

const inputCls =
  "w-full h-9 px-3 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-ocean-500";
const labelCls =
  "block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1";

export function CreateCommodityForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    canonical_name: "",
    cargo_type: "Dry Bulk" as "Dry Bulk" | "Break Bulk",
    imsbc_category: "Cat_C" as (typeof IMSBC_CATS)[number],
    is_dg: false,
    is_grain: false,
    default_sf_m3t: "",
    un_number: "",
    imo_class: "",
    aliases: "",
    sort_order: "100",
    notes: "",
  });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.canonical_name.trim()) {
      toast.error("Canonical name is required.");
      return;
    }
    startTransition(async () => {
      const result = await createCommodity({
        canonical_name: form.canonical_name.trim(),
        cargo_type: form.cargo_type,
        imsbc_category: form.imsbc_category,
        is_dg: form.is_dg,
        is_grain: form.is_grain,
        default_sf_m3t: form.default_sf_m3t
          ? parseFloat(form.default_sf_m3t)
          : null,
        un_number: form.un_number.trim() || undefined,
        imo_class: form.imo_class.trim() || undefined,
        display_aliases: form.aliases
          ? form.aliases
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        sort_order: parseInt(form.sort_order, 10) || 100,
        notes: form.notes.trim() || undefined,
      });
      if (result.success) {
        toast.success(`${form.canonical_name} added to the commodity list.`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to create commodity.");
      }
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-ocean-600 bg-ocean-50 hover:bg-ocean-100 border-2 border-dashed border-ocean-200 rounded-2xl transition-colors w-full"
      >
        <Plus className="w-4 h-4" /> Add new commodity
      </button>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
      <h3 className="text-sm font-bold text-slate-800">New commodity</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className={labelCls}>
            Canonical name <span className="text-red-400">*</span>
          </label>
          <input
            value={form.canonical_name}
            onChange={(e) => set("canonical_name", e.target.value)}
            placeholder="e.g. Grain (Wheat)"
            className={inputCls}
          />
          <p className="text-[10px] text-slate-400 mt-1">
            This is permanent — it is stored on every cargo listing. Choose
            carefully.
          </p>
        </div>

        <div>
          <label className={labelCls}>
            Cargo type <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-2">
            {CARGO_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("cargo_type", t)}
                className={cn(
                  "flex-1 py-2 text-xs font-semibold rounded-xl border-2 transition-all",
                  form.cargo_type === t
                    ? "border-ocean-500 bg-ocean-50 text-ocean-700"
                    : "border-slate-200 text-slate-500 hover:border-ocean-200",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>
            IMSBC category <span className="text-red-400">*</span>
          </label>
          <select
            value={form.imsbc_category}
            onChange={(e) => set("imsbc_category", e.target.value)}
            className={cn(inputCls, "cursor-pointer")}
          >
            {IMSBC_CATS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Dangerous goods (DG)?</label>
          <div className="flex gap-2">
            {([false, true] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => set("is_dg", v)}
                className={cn(
                  "flex-1 py-2 text-xs font-semibold rounded-xl border-2 transition-all",
                  form.is_dg === v
                    ? "border-ocean-500 bg-ocean-50 text-ocean-700"
                    : "border-slate-200 text-slate-500 hover:border-ocean-200",
                )}
              >
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Grain cargo?</label>
          <div className="flex gap-2">
            {([false, true] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => set("is_grain", v)}
                className={cn(
                  "flex-1 py-2 text-xs font-semibold rounded-xl border-2 transition-all",
                  form.is_grain === v
                    ? "border-ocean-500 bg-ocean-50 text-ocean-700"
                    : "border-slate-200 text-slate-500 hover:border-ocean-200",
                )}
              >
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Default stowage factor (m³/t)</label>
          <input
            type="number"
            step="0.1"
            value={form.default_sf_m3t}
            onChange={(e) => set("default_sf_m3t", e.target.value)}
            placeholder="e.g. 47.0"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Sort order</label>
          <input
            type="number"
            value={form.sort_order}
            onChange={(e) => set("sort_order", e.target.value)}
            className={inputCls}
          />
        </div>

        {form.is_dg && (
          <>
            <div>
              <label className={labelCls}>UN number</label>
              <input
                value={form.un_number}
                onChange={(e) => set("un_number", e.target.value)}
                placeholder="e.g. 1942"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>IMO class</label>
              <input
                value={form.imo_class}
                onChange={(e) => set("imo_class", e.target.value)}
                placeholder="e.g. 5.1"
                className={inputCls}
              />
            </div>
          </>
        )}

        <div className="col-span-2">
          <label className={labelCls}>Display aliases (comma-separated)</label>
          <input
            value={form.aliases}
            onChange={(e) => set("aliases", e.target.value)}
            placeholder="e.g. Wheat, HMS, HMS 1/2"
            className={inputCls}
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Used in autocomplete search only. Never stored on cargo records.
          </p>
        </div>

        <div className="col-span-2">
          <label className={labelCls}>Notes (optional)</label>
          <input
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Any notes…"
            className={inputCls}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button
          onClick={() => setOpen(false)}
          className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-ocean-600 hover:bg-ocean-700 text-white rounded-xl transition-colors disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Create commodity
        </button>
      </div>
    </div>
  );
}
