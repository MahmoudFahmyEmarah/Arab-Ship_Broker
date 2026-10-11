// Fixture Room · the standard subjects offered as one-click chips (Wave 3).
// The three subjects almost every dry-bulk fixture carries. A chip adds the
// subject through the ordinary add_fixture_subject command (same checks,
// same ledger event); it is only a shortcut for the wording and the side
// that usually lifts it, and either can be edited by adding a custom one.
import type { FixtureSubjectView } from "./types";

export interface StandardSubject { key: "stem" | "owners_management" | "cp_details"; title: string; responsibleSide: "cargo" | "vessel" | null; hint: string }

export const STANDARD_SUBJECTS: readonly StandardSubject[] = [
  { key: "stem", title: "Subject shippers' stem approval", responsibleSide: "cargo", hint: "The cargo side confirms the shippers' stem for the laycan." },
  { key: "owners_management", title: "Subject owners' management approval", responsibleSide: "vessel", hint: "The vessel side confirms its management's approval of the fixture." },
  { key: "cp_details", title: "Subject C/P details", responsibleSide: null, hint: "Both sides agree the charter party details (sub details)." },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The standard subjects not already in the room (a failed one counts as present: the fixture failed with it). */
export function missingStandardSubjects(subjects: readonly Pick<FixtureSubjectView, "title">[]): StandardSubject[] {
  const have = new Set(subjects.map((s) => norm(s.title)));
  return STANDARD_SUBJECTS.filter((s) => !have.has(norm(s.title)));
}

/**
 * O2ALL-006: the open deadline proposal of a subject, from the room's ledger: its latest subject.extension_proposed
 * that no later proposal, acceptance, refusal, lift or failure of the same subject answered. Mirrors
 * public.fn_fixture_subject_pending_extension.
 */
export interface PendingExtension { eventId: number; deadlineAt: string; proposedBySide: "cargo" | "vessel" }
export function pendingExtension(events: readonly { id: number; seq: number; type: string; payload: Record<string, unknown> }[], subjectId: string): PendingExtension | null {
  const mine = events.filter((e) => String(e.payload?.subjectId ?? "") === subjectId).sort((a, b) => a.seq - b.seq);
  const last = mine.filter((e) => ["subject.extension_proposed", "subject.extended", "subject.extension_declined", "subject.lifted", "subject.failed"].includes(e.type)).pop();
  if (!last || last.type !== "subject.extension_proposed") return null;
  const side = last.payload.proposedBySide;
  if (side !== "cargo" && side !== "vessel") return null;
  return { eventId: last.id, deadlineAt: String(last.payload.deadlineAt ?? ""), proposedBySide: side };
}
