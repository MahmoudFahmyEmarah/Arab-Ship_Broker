import { AlertTriangle } from "lucide-react";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminBadge } from "@/components/admin/AdminBadge";
import { QuestionRowActions } from "@/components/admin/safety/QuestionRowActions";
import { CreateQuestionForm } from "@/components/admin/safety/CreateQuestionForm";
import { cn } from "@/lib/utils";

type SafetyQuestionRow = {
  id: string;
  question_key: string;
  question_text: string;
  answer_type: string;
  select_options: string[] | null;
  applies_to_cargo_type: string[] | null;
  applies_to_categories: string[] | null;
  is_required: boolean;
  is_matchmaking_field: boolean;
  matchmaking_column: string | null;
  section_label: string | null;
  help_text: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const ANSWER_TYPE_COLORS: Record<string, string> = {
  boolean: "bg-green-50 text-green-700 border-green-200",
  number: "bg-blue-50 text-blue-700 border-blue-200",
  text: "bg-asb-gray-100 text-asb-gray-700 border-asb-gray-200",
  select: "bg-purple-50 text-purple-700 border-purple-200",
  multi_select: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

export default async function AdminSafetyQuestionsPage() {
  await requireAdmin({ section: "safety" });
  const supabase = await getAdminSupabaseClient();

  const { data } = await supabase
    .from("safety_questions")
    .select("*")
    .order("sort_order", { ascending: true });

  const questions = (data ?? []) as SafetyQuestionRow[];
  const active = questions.filter((q) => q.is_active);
  const inactive = questions.filter((q) => !q.is_active);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Safety Questions"
        subtitle={`${active.length} active · ${inactive.length} inactive`}
      />

      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
        <div className="text-xs text-red-700 leading-relaxed space-y-1">
          <p>
            <strong>question_key is permanent.</strong> Once a question has
            answers against it, the key can never change — it is the machine
            reference that links answers to questions. All other fields (text,
            type, options, sort order) are freely editable.
          </p>
          <p>
            To retire a question: <strong>deactivate</strong> it. Existing
            answers are preserved.
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold text-asb-gray-500 uppercase tracking-wider mb-3">
          Active questions ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-asb-gray-400 py-4">No active questions</p>
        ) : (
          <div className="space-y-2">
            {active.map((q) => (
              <QuestionCard key={q.id} question={q} />
            ))}
          </div>
        )}
      </div>

      {inactive.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-asb-gray-400 uppercase tracking-wider mb-3">
            Inactive ({inactive.length})
          </h2>
          <div className="space-y-2 opacity-60">
            {inactive.map((q) => (
              <QuestionCard key={q.id} question={q} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold text-asb-gray-500 uppercase tracking-wider mb-3">
          Add new safety question
        </h2>
        <CreateQuestionForm />
      </div>
    </div>
  );
}

function QuestionCard({ question: q }: { question: SafetyQuestionRow }) {
  return (
    <div
      className={cn(
        "bg-white border rounded p-5",
        q.is_active ? "border-asb-gray-200" : "border-asb-gray-100",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <code className="text-xs font-bold font-mono text-asb-gray-700 bg-asb-gray-100 px-2 py-0.5 rounded-md">
              {q.question_key}
            </code>
            <span
              className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-md border",
                ANSWER_TYPE_COLORS[q.answer_type] ??
                  "bg-asb-gray-100 text-asb-gray-700",
              )}
            >
              {q.answer_type}
            </span>
            {q.is_required && <AdminBadge variant="pending" label="Required" />}
            {q.is_matchmaking_field && (
              <AdminBadge
                variant="approved"
                label={`→ ${q.matchmaking_column ?? "matchmaking"}`}
              />
            )}
            <span className="text-[10px] text-asb-gray-400 font-mono">
              sort: {q.sort_order}
            </span>
          </div>

          <p className="text-sm font-semibold text-asb-navy mb-1.5">
            {q.question_text}
          </p>

          <div className="flex items-center gap-3 text-xs text-asb-gray-400 flex-wrap">
            {q.section_label && (
              <span>
                Section:{" "}
                <span className="font-medium text-asb-gray-700">
                  {q.section_label}
                </span>
              </span>
            )}
            {q.applies_to_cargo_type && (
              <span>
                Types:{" "}
                <span className="font-medium text-asb-gray-700">
                  {q.applies_to_cargo_type.join(", ")}
                </span>
              </span>
            )}
            {q.applies_to_categories && (
              <span>
                Categories:{" "}
                <span className="font-medium text-asb-gray-700">
                  {q.applies_to_categories.join(", ")}
                </span>
              </span>
            )}
            {q.select_options && q.select_options.length > 0 && (
              <span>
                Options:{" "}
                <span className="font-medium text-asb-gray-700">
                  {q.select_options.join(", ")}
                </span>
              </span>
            )}
          </div>

          {q.help_text && (
            <p className="text-xs text-asb-gray-400 mt-1.5 italic">
              {q.help_text}
            </p>
          )}
        </div>

        <div className="shrink-0">
          <QuestionRowActions question={q} />
        </div>
      </div>
    </div>
  );
}
