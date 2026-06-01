"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, AlertTriangle } from "lucide-react";
import { createSafetyQuestion } from "@/app/(admin)/admin/safety-questions/actions";
import { cn } from "@/lib/utils";

const ANSWER_TYPES = [
  "boolean",
  "number",
  "text",
  "select",
  "multi_select",
] as const;
const CARGO_TYPES = ["Dry Bulk", "Break Bulk"] as const;
const IMSBC_CATS = ["Cat_A", "Cat_B", "Cat_C", "DG", "Non_DG"] as const;

const inputCls =
  "w-full h-9 px-3 text-sm rounded border border-asb-gray-200 bg-white focus:outline-none  focus:border-asb-blue";
const labelCls =
  "block text-xs font-bold text-asb-gray-500 uppercase tracking-wider mb-1";

export function CreateQuestionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    question_key: "",
    question_text: "",
    answer_type: "boolean" as (typeof ANSWER_TYPES)[number],
    is_required: false,
    is_matchmaking_field: false,
    matchmaking_column: "",
    section_label: "",
    help_text: "",
    select_options: "",
    sort_order: "100",
    applies_cargo: [] as string[],
    applies_cats: [] as string[],
  });

  const toggleArr = (key: "applies_cargo" | "applies_cats", val: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(val)
        ? f[key].filter((v) => v !== val)
        : [...f[key], val],
    }));
  };

  const handleSubmit = () => {
    if (!form.question_key.trim() || !form.question_text.trim()) {
      toast.error("question_key and question_text are required.");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(form.question_key)) {
      toast.error(
        "question_key must be snake_case (lowercase letters, numbers, underscores only).",
      );
      return;
    }
    startTransition(async () => {
      const result = await createSafetyQuestion({
        question_key: form.question_key.trim(),
        question_text: form.question_text.trim(),
        answer_type: form.answer_type,
        applies_to_cargo_type: form.applies_cargo.length
          ? form.applies_cargo
          : [],
        applies_to_categories: form.applies_cats.length
          ? form.applies_cats
          : [],
        is_required: form.is_required,
        is_matchmaking_field: form.is_matchmaking_field,
        matchmaking_column: form.matchmaking_column.trim() || undefined,
        section_label: form.section_label.trim() || undefined,
        help_text: form.help_text.trim() || undefined,
        select_options: form.select_options
          ? form.select_options
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        sort_order: parseInt(form.sort_order, 10) || 100,
      });
      if (result.success) {
        toast.success(`Question "${form.question_key}" created.`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to create question.");
      }
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-asb-blue bg-asb-blue-light hover:bg-asb-blue-light border-2 border-dashed border-asb-blue rounded transition-colors w-full"
      >
        <Plus className="w-4 h-4" /> Add new safety question
      </button>
    );
  }

  return (
    <div className="bg-white border border-asb-gray-200 rounded p-6 space-y-5">
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded px-3 py-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700">
          <strong>question_key is permanent.</strong> Choose it carefully using
          snake_case. Once this question has answers, renaming the key will
          orphan them permanently.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>
            question_key <span className="text-red-400">*</span>
          </label>
          <input
            value={form.question_key}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                question_key: e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_]/g, "_"),
              }))
            }
            placeholder="e.g. requires_geared"
            className={cn(inputCls, "font-mono")}
          />
          <p className="text-[10px] text-asb-gray-400 mt-1">
            snake_case · permanent · machine reference
          </p>
        </div>
        <div>
          <label className={labelCls}>
            Answer type <span className="text-red-400">*</span>
          </label>
          <select
            value={form.answer_type}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                answer_type: e.target.value as (typeof ANSWER_TYPES)[number],
              }))
            }
            className={cn(inputCls, "cursor-pointer")}
          >
            {ANSWER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2">
          <label className={labelCls}>
            Question text <span className="text-red-400">*</span>
          </label>
          <input
            value={form.question_text}
            onChange={(e) =>
              setForm((f) => ({ ...f, question_text: e.target.value }))
            }
            placeholder="e.g. Does this cargo require a geared vessel?"
            className={inputCls}
          />
        </div>

        {(form.answer_type === "select" ||
          form.answer_type === "multi_select") && (
          <div className="col-span-2">
            <label className={labelCls}>Select options (comma-separated)</label>
            <input
              value={form.select_options}
              onChange={(e) =>
                setForm((f) => ({ ...f, select_options: e.target.value }))
              }
              placeholder="e.g. Grab, Conveyor, Spout"
              className={inputCls}
            />
          </div>
        )}

        <div>
          <label className={labelCls}>Applies to cargo type</label>
          <div className="flex gap-2 mt-1">
            {CARGO_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleArr("applies_cargo", t)}
                className={cn(
                  "flex-1 py-1.5 text-xs font-semibold rounded border-2 transition-all",
                  form.applies_cargo.includes(t)
                    ? "border-asb-blue bg-asb-blue-light text-asb-blue"
                    : "border-asb-gray-200 text-asb-gray-500",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-asb-gray-400 mt-1">
            None selected = applies to both
          </p>
        </div>

        <div>
          <label className={labelCls}>Applies to IMSBC category</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {IMSBC_CATS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleArr("applies_cats", c)}
                className={cn(
                  "py-1 px-2 text-[11px] font-bold rounded-lg border-2 transition-all",
                  form.applies_cats.includes(c)
                    ? "border-asb-blue bg-asb-blue-light text-asb-blue"
                    : "border-asb-gray-200 text-asb-gray-500",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Section label</label>
          <input
            value={form.section_label}
            onChange={(e) =>
              setForm((f) => ({ ...f, section_label: e.target.value }))
            }
            placeholder="e.g. Vessel requirements"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Sort order</label>
          <input
            type="number"
            value={form.sort_order}
            onChange={(e) =>
              setForm((f) => ({ ...f, sort_order: e.target.value }))
            }
            className={inputCls}
          />
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_required}
              onChange={(e) =>
                setForm((f) => ({ ...f, is_required: e.target.checked }))
              }
              className="rounded border-asb-gray-200"
            />
            <span className="text-sm font-medium text-asb-ink-soft">Required</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_matchmaking_field}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  is_matchmaking_field: e.target.checked,
                }))
              }
              className="rounded border-asb-gray-200"
            />
            <span className="text-sm font-medium text-asb-ink-soft">
              Matchmaking field
            </span>
          </label>
        </div>

        {form.is_matchmaking_field && (
          <div>
            <label className={labelCls}>Matchmaking column</label>
            <input
              value={form.matchmaking_column}
              onChange={(e) =>
                setForm((f) => ({ ...f, matchmaking_column: e.target.value }))
              }
              placeholder="e.g. requires_geared"
              className={cn(inputCls, "font-mono")}
            />
            <p className="text-[10px] text-asb-gray-400 mt-1">
              Column on cargo_listings that receives this answer
            </p>
          </div>
        )}

        <div className="col-span-2">
          <label className={labelCls}>
            Help text (shown under the question)
          </label>
          <input
            value={form.help_text}
            onChange={(e) =>
              setForm((f) => ({ ...f, help_text: e.target.value }))
            }
            placeholder="Optional hint shown to the user"
            className={inputCls}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-asb-gray-100">
        <button
          onClick={() => setOpen(false)}
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
            <Plus className="w-4 h-4" />
          )}
          Create question
        </button>
      </div>
    </div>
  );
}
