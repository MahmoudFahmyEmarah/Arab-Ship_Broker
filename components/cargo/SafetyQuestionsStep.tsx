"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, HelpCircle } from "lucide-react";

import { SafetyQuestion, CargoType, ImsbcCategory } from "@/lib/schemas/cargo";
import { getSafetyQuestions } from "@/sdk/app/commodities";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface SafetyQuestionsStepProps {
  cargoType: CargoType;
  imsbcCategory: ImsbcCategory;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors?: Record<string, string>;
}

export function SafetyQuestionsStep({
  cargoType,
  imsbcCategory,
  values,
  onChange,
  errors = {},
}: SafetyQuestionsStepProps) {
  const [questions, setQuestions] = useState<SafetyQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const qs = await getSafetyQuestions(supabase, cargoType, imsbcCategory);
        setQuestions(qs);
      } catch (err) {
        console.error("Failed to load safety questions:", err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [cargoType, imsbcCategory]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading safety requirements…</span>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-800">
        <ShieldCheck className="w-5 h-5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">
            No additional safety questions
          </p>
          <p className="text-xs text-green-700 mt-0.5">
            This commodity ({imsbcCategory}) has no additional requirements at
            this time.
          </p>
        </div>
      </div>
    );
  }

  // Group questions by section_label
  const sections = questions.reduce<Record<string, SafetyQuestion[]>>(
    (acc, q) => {
      const section = q.section_label ?? "General";
      if (!acc[section]) acc[section] = [];
      acc[section].push(q);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-8">
      {Object.entries(sections).map(([sectionLabel, sectionQuestions]) => (
        <div key={sectionLabel}>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 pb-2 border-b border-slate-100">
            {sectionLabel}
          </h3>
          <div className="space-y-5">
            {sectionQuestions.map((q) => (
              <QuestionInput
                key={q.question_key}
                question={q}
                value={values[q.question_key] ?? ""}
                onChange={(v) => onChange(q.question_key, v)}
                error={errors[q.question_key]}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Individual question renderer ─────────────────────────────────────────────

interface QuestionInputProps {
  question: SafetyQuestion;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

function QuestionInput({
  question: q,
  value,
  onChange,
  error,
}: QuestionInputProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        <label
          className={cn(
            "text-sm font-medium text-slate-700",
            q.is_required &&
              "after:content-['*'] after:text-red-500 after:ml-1",
          )}
        >
          {q.question_text}
          {q.is_matchmaking_field && (
            <span className="ml-2 text-xs font-normal text-ocean-600 bg-ocean-50 px-1.5 py-0.5 rounded">
              used in matching
            </span>
          )}
        </label>
        {q.help_text && (
          <div className="group relative shrink-0 mt-0.5">
            <HelpCircle className="w-4 h-4 text-slate-400 cursor-help" />
            <div className="hidden group-hover:block absolute left-5 top-0 z-10 w-56 bg-slate-800 text-white text-xs p-2.5 rounded-lg shadow-lg">
              {q.help_text}
            </div>
          </div>
        )}
      </div>

      {q.answer_type === "boolean" && (
        <div className="flex gap-3">
          {["true", "false"].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={cn(
                "flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-all",
                value === v
                  ? "border-ocean-500 bg-ocean-50 text-ocean-700"
                  : "border-slate-200 text-slate-600 hover:border-ocean-300",
              )}
            >
              {v === "true" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      )}

      {q.answer_type === "number" && (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:border-ocean-500 focus:bg-white transition-all",
            error && "border-red-300",
          )}
        />
      )}

      {q.answer_type === "text" && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className={cn(
            "w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:border-ocean-500 focus:bg-white transition-all resize-none",
            error && "border-red-300",
          )}
        />
      )}

      {q.answer_type === "select" && q.select_options && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:border-ocean-500 focus:bg-white transition-all",
            error && "border-red-300",
          )}
        >
          <option value="">Select…</option>
          {q.select_options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {q.answer_type === "multi_select" && q.select_options && (
        <div className="flex flex-wrap gap-2">
          {q.select_options.map((opt) => {
            const selected = value.split(",").filter(Boolean).includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  const current = value.split(",").filter(Boolean);
                  const next = selected
                    ? current.filter((v) => v !== opt)
                    : [...current, opt];
                  onChange(next.join(","));
                }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all",
                  selected
                    ? "border-ocean-500 bg-ocean-50 text-ocean-700"
                    : "border-slate-200 text-slate-600 hover:border-ocean-300",
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
