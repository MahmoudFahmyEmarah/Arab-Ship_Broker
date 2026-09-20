// Data Quality capabilities (20 Sep 2026). Pure, client-safe.
//
// The admin registry (lib/admin/sections.ts) answers "edit" | "run" | "view"
// | "none" for the dataquality section. This is the one place that turns
// that answer into what a server action may do:
//
//   view   read every screen; poll a run (read-only)
//   run    everything view can, plus: start, pause, resume, cancel, recover
//          and retry audit runs — compute and AI spend
//   edit   everything run can, plus: rules, gate matrix, fixes, suggestions,
//          settings, registry, scheduling, notification requeue
//
// Every server action in app/(admin)/admin/data-quality/actions.ts calls
// gate(<capability>) which calls assertDqCapability; scripts/dq-authz-check.ts
// proves the matrix and scans the actions file for the calls.
import type { Access } from "@/lib/admin/sections";

export type DqCapability = "view" | "run" | "edit";

export interface DqCapabilities { view: boolean; run: boolean; edit: boolean }

export function dqCapabilities(access: Access | null | undefined): DqCapabilities {
  switch (access) {
    case "edit": return { view: true, run: true, edit: true };
    case "run": return { view: true, run: true, edit: false };
    case "view": return { view: true, run: false, edit: false };
    default: return { view: false, run: false, edit: false };
  }
}

export const DQ_CAPABILITY_DENIED: Record<DqCapability, string> = {
  view: "You do not have access to Data quality.",
  run: "Running audits needs the run permission on Data quality — ask the owner.",
  edit: "This needs edit access to Data quality — ask the owner.",
};

/** Throws with the console's wording when the access level does not carry the capability. */
export function assertDqCapability(access: Access | null | undefined, need: DqCapability): DqCapabilities {
  const caps = dqCapabilities(access);
  if (!caps[need]) throw new Error(DQ_CAPABILITY_DENIED[need]);
  return caps;
}
