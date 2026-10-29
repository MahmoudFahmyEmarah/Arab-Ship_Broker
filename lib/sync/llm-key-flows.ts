// The two state transitions of a Data Sync LLM key — save (every insert and edit lands inactive) and
// activation (only after a passing provider test of exactly the stored values, through the version-bound
// switch). Pure over injected dependencies, so scripts/llm-key-flows-check.ts can run them against a fake
// client; app/(admin)/admin/data-sync/settings-actions.ts wires the real Supabase client (C2O-178).
import { activationRefusal, mayActivate, type LlmProviderFamily } from "@/lib/sync/llm-provider";

export type ProbeData = { model: string; modelFound: boolean | null; family: LlmProviderFamily; token: string };
export type ProbeOutcome = { ok: true; data: ProbeData } | { ok: false; error: string };
export type KeyAudit = { action: string; targetId: string; summary: string; ok?: boolean; detail?: Record<string, unknown> };

export interface KeyFlowDeps {
  /** whether the credential is the active key now (throws on a read error) */
  isActive(id: string): Promise<boolean>;
  /** save_llm_credential — always called with makeActive false; returns the id (throws on error) */
  save(input: SaveKeyInput): Promise<string>;
  /** the provider/model test of the STORED values, with the version token it read */
  probe(id: string): Promise<ProbeOutcome>;
  /** set_active_llm_credential_if_unchanged — 'activated' | 'changed' | 'not_found' (throws on error) */
  activateIfUnchanged(id: string, token: string): Promise<string>;
  audit(entry: KeyAudit): Promise<void>;
}

export interface SaveKeyInput {
  id?: string;
  label: string;
  vendor: string;
  model: string;
  baseUrl: string | null;
  secret: string | null;
  makeActive: boolean;
}

/** Test, rule, version-bound switch, audit of the real outcome. Null = activated, else the refusal reason. */
export async function activateIfVerified(d: KeyFlowDeps, id: string): Promise<string | null> {
  const probe = await d.probe(id);
  if (!probe.ok) return probe.error;
  if (!mayActivate(probe.data.family, probe.data.modelFound)) {
    return `the provider did not confirm the model "${probe.data.model}" — pick a model it serves and test again`;
  }
  // an RPC error is a refusal, never a thrown failure: the save already happened (inactive) and was audited, so the
  // owner must see "saved, not activated", not "could not save" (which invites a duplicate save)
  let result: string;
  try {
    result = await d.activateIfUnchanged(id, probe.data.token);
  } catch (e) {
    return `the activation could not be recorded (${e instanceof Error ? e.message : String(e)}) — the key stays inactive`;
  }
  const refusal = activationRefusal(result);
  if (refusal) return refusal;
  await d.audit({ action: "settings.llm.activate", targetId: id, summary: `Activated the LLM key after a passing provider test (${probe.data.model})` });
  return null;
}

/** Save inactive; when asked, activate only through activateIfVerified. An edit of the active key always takes it
 * out of service first and is logged as such. */
export async function saveAndMaybeActivate(d: KeyFlowDeps, input: SaveKeyInput): Promise<{ id: string; activated: boolean; notActivated?: string }> {
  const wasActive = input.id ? await d.isActive(input.id) : false;
  const id = await d.save({ ...input, makeActive: false });
  await d.audit({
    action: "settings.llm.save", targetId: id,
    summary: `${input.id ? "Updated" : "Added"} LLM key “${input.label}” (${input.vendor} · ${input.model})${input.secret ? " — secret rotated" : ""} — saved inactive`,
    detail: { vendor: input.vendor, model: input.model, baseUrl: input.baseUrl, secretChanged: !!input.secret, wasActive, activationRequested: input.makeActive },
  });
  if (wasActive) {
    await d.audit({ action: "settings.llm.deactivate", targetId: id, summary: "The edit took the active LLM key out of service until it passes the provider test", ok: false });
  }
  if (input.makeActive) {
    const refused = await activateIfVerified(d, id);
    if (!refused) return { id, activated: true };
    return { id, activated: false, notActivated: wasActive ? `${refused}. The key is now INACTIVE (it was active before the edit)` : refused };
  }
  if (wasActive) {
    return { id, activated: false, notActivated: "the edit took the key out of service — tick \"Make this the active key\" (it is tested first) to use it again" };
  }
  return { id, activated: false };
}
