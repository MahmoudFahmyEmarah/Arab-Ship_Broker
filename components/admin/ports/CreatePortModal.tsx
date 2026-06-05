"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, MapPin, Loader2 } from "lucide-react";
import { createPort } from "@/app/(admin)/admin/ports/actions";
import { cn } from "@/lib/utils";

const ZONES = [
  "B.SEA",
  "E.MED",
  "W.MED",
  "C.MED",
  "ADRIATIC",
  "R.SEA",
  "AG",
  "A.SEA",
  "WCAF",
  "ECAF",
  "NCONT",
  "CARIB",
  "F.EAST",
  "ECI",
];
const PORT_TYPES = ["Sea Port", "River Port", "Sea/River"];

export function CreatePortModal() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    locode: "",
    trade_name: "",
    country: "",
    zone: "",
    port_type: "Sea Port",
    notes: "",
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const close = () => router.back();

  const handleSubmit = () => {
    if (
      !form.locode.trim() ||
      !form.trade_name.trim() ||
      !form.country.trim() ||
      !form.zone
    ) {
      toast.error("LOCODE, name, country, and zone are required.");
      return;
    }
    startTransition(async () => {
      const result = await createPort({
        locode: form.locode.trim().toUpperCase(),
        trade_name: form.trade_name.trim(),
        country: form.country.trim(),
        zone: form.zone,
        port_type: form.port_type,
        notes: form.notes.trim() || undefined,
      });
      if (result.success) {
        toast.success(`Port ${form.trade_name} created.`);
        router.push("/admin/ports");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to create port.");
      }
    });
  };

  const inputCls =
    "w-full h-9 px-3 text-sm rounded border border-asb-gray-200 bg-white focus:outline-none  focus:border-asb-blue focus:border-asb-blue";
  const labelCls =
    "block text-xs font-bold text-asb-gray-500 uppercase tracking-wider mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-asb-navy-deep/50 backdrop-blur-sm">
      <div className="bg-white rounded shadow-2xl w-full max-w-lg border border-asb-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-asb-gray-100">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-asb-blue" />
            <h2 className="text-base font-bold text-asb-navy">Add new port</h2>
          </div>
          <button
            onClick={close}
            className="p-1.5 text-asb-gray-400 hover:text-asb-ink hover:bg-asb-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>
                LOCODE <span className="text-red-400">*</span>
              </label>
              <input
                value={form.locode}
                onChange={(e) => set("locode", e.target.value.toUpperCase())}
                placeholder="e.g. EG ALY"
                maxLength={10}
                className={cn(inputCls, "font-mono")}
              />
              <p className="text-[10px] text-asb-gray-400 mt-1">
                UN/LOCODE format: 2-letter country + 3-letter code
              </p>
            </div>
            <div>
              <label className={labelCls}>
                Port name <span className="text-red-400">*</span>
              </label>
              <input
                value={form.trade_name}
                onChange={(e) => set("trade_name", e.target.value)}
                placeholder="e.g. Alexandria"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>
                Country <span className="text-red-400">*</span>
              </label>
              <input
                value={form.country}
                onChange={(e) => set("country", e.target.value)}
                placeholder="e.g. Egypt"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>
                Zone <span className="text-red-400">*</span>
              </label>
              <select
                value={form.zone}
                onChange={(e) => set("zone", e.target.value)}
                className={cn(inputCls, "cursor-pointer")}
              >
                <option value="">Select zone…</option>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Port type</label>
            <div className="flex gap-2">
              {PORT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("port_type", t)}
                  className={cn(
                    "flex-1 py-2 text-xs font-semibold rounded border-2 transition-all",
                    form.port_type === t
                      ? "border-asb-blue bg-asb-blue-light text-asb-blue"
                      : "border-asb-gray-200 text-asb-gray-500 hover:border-asb-blue",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes (optional)</label>
            <input
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="e.g. Main grain export hub, draft limit 12m"
              className={inputCls}
            />
          </div>

          <p className="text-xs text-asb-gray-400">
            Ports created here are immediately verified and available in port
            autocomplete.
          </p>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-asb-gray-100">
          <button
            onClick={close}
            className="px-4 py-2 text-sm font-semibold text-asb-gray-700 hover:bg-asb-gray-100 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-asb-blue hover:bg-asb-navy text-white rounded transition-colors disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MapPin className="w-4 h-4" />
            )}
            Create port
          </button>
        </div>
      </div>
    </div>
  );
}
