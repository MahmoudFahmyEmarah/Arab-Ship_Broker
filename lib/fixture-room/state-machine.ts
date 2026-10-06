// Fixture Room · room state machine, as the database enforces it (23 Sep 2026).
//
// The database is the authority (every command checks the locked row); this
// module lets the UI and the pure tests reason about the same matrix.
import { FIXTURE_TERMINAL_STATUSES, type FixtureRoomStatus, type FixtureTermStatus } from "./types";

export type FixtureCommand =
  | "create_fixture_room" | "invite_fixture_party" | "respond_fixture_invitation"
  | "submit_fixture_proposal" | "withdraw_fixture_proposal" | "accept_fixture_proposal"
  | "reopen_fixture_term" | "set_fixture_term_flag"
  | "add_fixture_subject" | "lift_fixture_subject" | "fail_fixture_subject" | "extend_fixture_subject"
  | "fix_fixture_on_subjects" | "publish_fixture_recap" | "acknowledge_fixture_recap"
  | "post_fixture_message" | "agree_fixture_disclosure" | "close_fixture_room" | "redact_fixture_message"
  | "extend_fixture_negotiation_window";

export const FIXTURE_ROOM_STATUSES: readonly FixtureRoomStatus[] = [
  "draft", "invited", "negotiating", "on_subjects", "fixed", "withdrawn", "failed", "expired",
];

export function isTerminal(status: FixtureRoomStatus): boolean {
  return FIXTURE_TERMINAL_STATUSES.includes(status);
}

/** Which statuses each command may run in (mirrors the FX_STATE checks in 20260923203000). */
export const COMMAND_STATUSES: Record<FixtureCommand, readonly FixtureRoomStatus[]> = {
  create_fixture_room: [],
  invite_fixture_party: ["draft", "invited", "negotiating", "on_subjects", "fixed"],
  respond_fixture_invitation: ["draft", "invited", "negotiating", "on_subjects", "fixed"],
  submit_fixture_proposal: ["invited", "negotiating"],
  withdraw_fixture_proposal: ["invited", "negotiating"],
  accept_fixture_proposal: ["invited", "negotiating"],
  reopen_fixture_term: ["negotiating", "on_subjects"],
  set_fixture_term_flag: ["invited", "negotiating"],
  add_fixture_subject: ["negotiating", "on_subjects"],
  lift_fixture_subject: ["on_subjects"],
  fail_fixture_subject: ["on_subjects"],
  extend_fixture_subject: ["on_subjects"],
  fix_fixture_on_subjects: ["negotiating"],
  publish_fixture_recap: ["negotiating", "on_subjects", "fixed"],
  acknowledge_fixture_recap: ["negotiating", "on_subjects", "fixed"],
  post_fixture_message: ["draft", "invited", "negotiating", "on_subjects", "fixed"],
  agree_fixture_disclosure: ["draft", "invited", "negotiating", "on_subjects", "fixed"],
  close_fixture_room: ["draft", "invited", "negotiating", "on_subjects"],
  redact_fixture_message: ["draft", "invited", "negotiating", "on_subjects", "fixed", "withdrawn", "failed", "expired"],
  extend_fixture_negotiation_window: ["invited", "negotiating"],
};

export function commandAllowedIn(command: FixtureCommand, status: FixtureRoomStatus): boolean {
  return COMMAND_STATUSES[command].includes(status);
}

/**
 * The transitions a command can cause. `fix_fixture_on_subjects` moves the
 * room only on the SECOND side's confirmation of the same terms and subjects
 * (PR-07), landing on `fixed` directly when no subject is open; the last
 * `lift_fixture_subject` fixes the room in the same statement. The clock
 * (run_fixture_room_clock, not a member command) expires an invited or
 * negotiating room whose negotiation window closed (PR-08).
 */
export const TRANSITIONS: readonly { from: FixtureRoomStatus; to: FixtureRoomStatus; by: FixtureCommand }[] = [
  { from: "draft", to: "invited", by: "invite_fixture_party" },
  { from: "invited", to: "negotiating", by: "submit_fixture_proposal" },
  { from: "invited", to: "negotiating", by: "accept_fixture_proposal" },
  { from: "negotiating", to: "on_subjects", by: "fix_fixture_on_subjects" },
  { from: "negotiating", to: "fixed", by: "fix_fixture_on_subjects" },
  { from: "on_subjects", to: "negotiating", by: "reopen_fixture_term" },
  { from: "on_subjects", to: "fixed", by: "lift_fixture_subject" },
  { from: "on_subjects", to: "failed", by: "fail_fixture_subject" },
  { from: "draft", to: "withdrawn", by: "close_fixture_room" },
  { from: "invited", to: "withdrawn", by: "close_fixture_room" },
  { from: "negotiating", to: "withdrawn", by: "close_fixture_room" },
  { from: "on_subjects", to: "withdrawn", by: "close_fixture_room" },
  { from: "draft", to: "failed", by: "close_fixture_room" },
  { from: "invited", to: "failed", by: "close_fixture_room" },
  { from: "negotiating", to: "failed", by: "close_fixture_room" },
  { from: "on_subjects", to: "failed", by: "close_fixture_room" },
  { from: "draft", to: "expired", by: "close_fixture_room" },
  { from: "invited", to: "expired", by: "close_fixture_room" },
  { from: "negotiating", to: "expired", by: "close_fixture_room" },
  { from: "on_subjects", to: "expired", by: "close_fixture_room" },
];

export function canTransition(from: FixtureRoomStatus, to: FixtureRoomStatus): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to);
}

/** Which statuses may be reached from a given one (empty for terminal and fixed). */
export function reachableFrom(from: FixtureRoomStatus): FixtureRoomStatus[] {
  return Array.from(new Set(TRANSITIONS.filter((t) => t.from === from).map((t) => t.to)));
}

export const ROOM_STATUS_LABEL: Record<FixtureRoomStatus, string> = {
  draft: "Draft",
  invited: "Invited",
  negotiating: "Negotiating",
  on_subjects: "Fixed on subs",
  fixed: "Clean fixed",
  withdrawn: "Withdrawn",
  failed: "Failed",
  expired: "Expired",
};

export const TERM_STATUS_LABEL: Record<FixtureTermStatus, string> = {
  open: "open",
  countered: "countered",
  agreed: "agreed",
  withdrawn: "withdrawn",
};

export type TimelineStep = { key: "enquiry" | "negotiating" | "subjects" | "fixed"; label: string; state: "done" | "active" | "todo" | "void" };

/** The four-step strip under the room header. */
export function timelineSteps(status: FixtureRoomStatus): TimelineStep[] {
  const order: Record<TimelineStep["key"], number> = { enquiry: 0, negotiating: 1, subjects: 2, fixed: 3 };
  const cur = status === "on_subjects" ? 2 : status === "fixed" ? 3 : status === "negotiating" ? 1 : 0;
  const void_ = isTerminal(status);
  return (
    [
      { key: "enquiry", label: "Enquiry" },
      { key: "negotiating", label: "Negotiating" },
      { key: "subjects", label: "Fixed on subs" },
      { key: "fixed", label: "Clean fixed" },
    ] as const
  ).map((s) => ({
    ...s,
    state: void_ ? "void" : order[s.key] < cur ? "done" : order[s.key] === cur ? "active" : "todo",
  }));
}
