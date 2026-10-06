"use client";

import { useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";

import {
  activateIntelligenceVersionAction,
  createIntelligenceVersionAction,
  diffIntelligenceRuleSetsAction,
  getIntelligenceBootstrap,
  getIntelligenceCloneInputAction,
  getIntelligenceRuleSetAction,
  type CreateIntelligenceVersionInput,
  type IntelligenceBootstrap,
} from "@/app/(admin)/admin/intelligence-rules/actions";
import { INTELLIGENCE_FIELDS } from "@/lib/intelligence";
import type {
  IntelligenceEvent,
  IntelligenceRuleSetDetail,
  IntelligenceRuleSetDiff,
  IntelligenceVersionSummary,
} from "@/sdk/app/intelligence";
import { AccessibleIdentifier } from "@/components/admin/AccessibleIdentifier";

import styles from "./IntelligenceRulesConsole.module.css";
import { StructuredDraftEditor } from "./StructuredDraftEditor";

type Tab = "rules" | "frameworks" | "versions" | "provenance" | "audit" | "new";
type Notice = { kind: "success" | "error" | "info"; text: string } | null;
type ReleaseOperation = "activate" | "rollback";

interface ReleaseTarget {
  ruleSetId: string;
  version: number;
  label: string;
  operation: ReleaseOperation;
}

const TABS: readonly { id: Exclude<Tab, "new">; label: string }[] = [
  { id: "rules", label: "Rules" },
  { id: "frameworks", label: "Frameworks" },
  { id: "versions", label: "Version history" },
  { id: "provenance", label: "Provenance" },
  { id: "audit", label: "Audit trail" },
];

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function shortId(value: string | null | undefined, length = 8): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function threshold(value: number | readonly [number, number] | null): string {
  if (value === null) return "—";
  return Array.isArray(value) ? `${value[0]} – ${value[1]}` : String(value);
}

function JsonState(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function StatusBadge({ active }: { active: boolean }) {
  return <span className={`adm-badge ${active ? "active" : "inactive"}`}>{active ? "Active" : "Inactive"}</span>;
}

function VersionBadge({ version, active }: { version: number; active: boolean }) {
  return (
    <span className={`adm-badge ${active ? "live" : "draft"}`}>
      v{version}{active ? " · live" : ""}
    </span>
  );
}

function ChangePills({ title, values, kind }: { title: string; values: string[]; kind: string }) {
  return (
    <div className={styles.changeRow}>
      <span className={styles.changeLabel}>{title}</span>
      <div className={styles.pills}>
        {values.length ? values.map((value) => (
          <span key={value} className={`${styles.changePill} ${styles[kind] ?? ""}`}>{value}</span>
        )) : <span className={styles.muted}>None</span>}
      </div>
    </div>
  );
}

function DiffPanel({ diff, versions }: { diff: IntelligenceRuleSetDiff; versions: IntelligenceVersionSummary[] }) {
  const label = (id: string) => {
    const version = versions.find((item) => item.ruleSetId === id);
    return version ? `v${version.version} · ${version.label}` : shortId(id);
  };
  return (
    <section className="adm-card" aria-labelledby="intelligence-diff-title">
      <div className="adm-card__head">
        <div>
          <span className="adm-card__title" id="intelligence-diff-title">Version comparison</span>
          <span className="adm-card__sub">{label(diff.leftRuleSetId)} → {label(diff.rightRuleSetId)}</span>
        </div>
      </div>
      <div className={styles.diffGrid}>
        {(["groups", "rules", "provenance"] as const).map((section) => (
          <div className={styles.diffBlock} key={section}>
            <h3>{section}</h3>
            <ChangePills title="Added" values={diff[section].added} kind="added" />
            <ChangePills title="Changed" values={diff[section].changed} kind="changed" />
            <ChangePills title="Removed" values={diff[section].removed} kind="removed" />
          </div>
        ))}
      </div>
    </section>
  );
}

function RulesView({ detail }: { detail: IntelligenceRuleSetDetail | null }) {
  if (!detail) return <div className="adm-empty">No intelligence rule-set version exists yet.</div>;
  const groupByCode = new Map(detail.document.groups.map((group) => [group.code, group]));
  return (
    <div className={styles.stack}>
      <section className="adm-card" aria-labelledby="intelligence-rules-title">
        <div className="adm-card__head">
          <div>
            <span className="adm-card__title" id="intelligence-rules-title">Rule catalogue</span>
            <span className="adm-card__sub">Closed fact vocabulary · deterministic operators · lower priority numbers run first.</span>
          </div>
        </div>
        <div className="adm-table">
          <table style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th>Rule</th><th>Group</th><th>Fact</th><th>Test</th><th>Signal</th><th>Message</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.document.rules.map((rule) => {
                const field = INTELLIGENCE_FIELDS[rule.field];
                const group = groupByCode.get(rule.group);
                return (
                  <tr key={rule.code}>
                    <td><strong>{rule.code}</strong><div className={styles.cellMeta}>Priority {rule.priority}</div></td>
                    <td>{group?.name ?? rule.group}<div className={styles.cellMeta}>{rule.entity}</div></td>
                    <td>{field.label}<div className={styles.cellMeta}>{rule.field}{field.unit ? ` · ${field.unit}` : ""}</div></td>
                    <td><code>{rule.operator}</code> {threshold(rule.threshold)}</td>
                    <td><span className={`${styles.severity} ${styles[rule.severity]}`}>{rule.severity}</span><div className={styles.cellMeta}>{rule.tag} · {rule.signalKey}</div></td>
                    <td className={styles.messageCell}>{rule.message}</td>
                    <td><StatusBadge active={rule.active} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FrameworksView({ detail }: { detail: IntelligenceRuleSetDetail | null }) {
  if (!detail) return <div className="adm-empty">No intelligence rule-set version exists yet.</div>;
  const frameworks = detail.document.groups.filter((group) => group.scope === "framework");
  return (
    <section className="adm-card" aria-labelledby="intelligence-frameworks-title">
      <div className="adm-card__head">
        <div>
          <span className="adm-card__title" id="intelligence-frameworks-title">Future frameworks</span>
          <span className="adm-card__sub">These are inert catalogue placeholders. They cannot contain rules or become active until a governed evaluator is released.</span>
        </div>
      </div>
      {!frameworks.length ? <div className="adm-empty">No future framework placeholders are recorded in this version.</div> : (
        <div className={styles.groupGrid}>
          {frameworks.map((group) => (
            <article className={styles.groupCard} key={group.code}>
              <div className={styles.groupHead}>
                <code>{group.code}</code>
                <StatusBadge active={group.active} />
              </div>
              <strong>{group.name}</strong>
              <p>{group.description ?? "No description."}</p>
              <div className={styles.groupMeta}>
                <span>Framework placeholder</span>
                <span>Priority {group.priority}</span>
                <span>0 executable rules</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ProvenanceView({ detail }: { detail: IntelligenceRuleSetDetail | null }) {
  if (!detail) return <div className="adm-empty">No provenance is available.</div>;
  const ruleByCode = new Map(detail.document.rules.map((rule) => [rule.code, rule]));
  return (
    <section className="adm-card" aria-labelledby="intelligence-provenance-title">
      <div className="adm-card__head">
        <div>
          <span className="adm-card__title" id="intelligence-provenance-title">Rule provenance</span>
          <span className="adm-card__sub">Source references and original guidance retained with this immutable version.</span>
        </div>
      </div>
      {!detail.provenance.length ? <div className="adm-empty">This version has no provenance records.</div> : (
        <div className="adm-table">
          <table style={{ minWidth: 900 }}>
            <thead><tr><th>Rule</th><th>Source reference</th><th>Original message</th><th>Curator note</th></tr></thead>
            <tbody>
              {detail.provenance.map((item) => (
                <tr key={item.ruleCode}>
                  <td><strong>{item.ruleCode}</strong><div className={styles.cellMeta}>{ruleByCode.get(item.ruleCode)?.tag ?? "Rule source"}</div></td>
                  <td className={styles.wrapCell}>{item.sourceRef}</td>
                  <td className={styles.wrapCell}>{item.originalMessage}</td>
                  <td className={styles.wrapCell}>{item.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AuditView({ events }: { events: IntelligenceEvent[] }) {
  if (!events.length) return <div className="adm-empty">No intelligence rule events have been recorded.</div>;
  return (
    <section className="adm-card" aria-labelledby="intelligence-audit-title">
      <div className="adm-card__head">
        <div>
          <span className="adm-card__title" id="intelligence-audit-title">Immutable audit trail</span>
          <span className="adm-card__sub">Creation, activation, rollback and idempotent release outcomes · newest first.</span>
        </div>
      </div>
      <div className="adm-table">
        <table style={{ minWidth: 940 }}>
          <thead><tr><th>When</th><th>Action</th><th>Version</th><th>Actor</th><th>Request</th><th>Transition</th></tr></thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{fmtDate(event.created_at)} UTC</td>
                <td><span className="adm-badge current">{event.action.replace("version.", "")}</span></td>
                <td>{event.version_no ? `v${event.version_no}` : "—"}<div className={styles.cellMeta} title={event.rule_set_id ?? undefined}>{shortId(event.rule_set_id)}</div></td>
                <td><code title={event.actor_user_id ?? undefined}>{shortId(event.actor_user_id)}</code></td>
                <td><code title={event.request_id ?? undefined}>{shortId(event.request_id)}</code></td>
                <td className={styles.wrapCell}><code>{JSON.stringify({ before: event.before_state, after: event.after_state })}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface NewVersionViewProps {
  draft: CreateIntelligenceVersionInput;
  setDraft: Dispatch<SetStateAction<CreateIntelligenceVersionInput>>;
  busy: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selected: IntelligenceRuleSetDetail | null;
  onPrepare: () => void;
}

function NewVersionView({
  draft, setDraft, busy, onSubmit, selected, onPrepare,
}: NewVersionViewProps) {
  const patch = <K extends keyof CreateIntelligenceVersionInput,>(key: K, value: CreateIntelligenceVersionInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className={styles.editorGrid}>
      <form className="adm-card" onSubmit={onSubmit}>
        <div className="adm-card__head">
          <div>
            <span className="adm-card__title">Create immutable version</span>
            <span className="adm-card__sub">
              Clone a version, make the documented change, then create a new snapshot. Nothing here edits the source version.<br />
              Base snapshot: {draft.basedOnId ? shortId(draft.basedOnId, 12) : "none (initial version)"}
            </span>
          </div>
          <button type="button" className="adm-btn small" onClick={onPrepare} disabled={!selected || busy !== null}>
            {busy === "clone" ? "Preparing…" : "Reset from selected"}
          </button>
        </div>
        <div className={styles.formGrid}>
          <label className="adm-field">
            <span className="adm-field__label">Version label</span>
            <input className="adm-input" required maxLength={120} value={draft.label} onChange={(event) => patch("label", event.target.value)} />
          </label>
          <label className={`adm-field ${styles.full}`}>
            <span className="adm-field__label">Change note</span>
            <textarea className="adm-textarea" required maxLength={1000} rows={3} value={draft.changeNote} onChange={(event) => patch("changeNote", event.target.value)} placeholder="What changed, why, and what evidence supports it?" />
          </label>
          <div className={styles.full}>
            <StructuredDraftEditor
              documentJson={draft.documentJson}
              provenanceJson={draft.provenanceJson}
              disabled={busy !== null}
              onDocumentChange={(value) => patch("documentJson", value)}
              onProvenanceChange={(value) => patch("provenanceJson", value)}
            />
          </div>
        </div>
        <div className={styles.releaseRow}>
          <span className={styles.muted}>The immutable version remains inactive until it is separately reviewed and explicitly activated from Version history.</span>
          <button type="submit" className="adm-btn primary" disabled={busy !== null}>
            {busy === "create" ? "Creating…" : "Create version"}
          </button>
        </div>
      </form>

      <aside className="adm-card">
        <div className="adm-card__head">
          <div>
            <span className="adm-card__title">Closed evaluator vocabulary</span>
            <span className="adm-card__sub">The server rejects unknown fields, operators, keys, invalid bounds and unreferenced groups.</span>
          </div>
        </div>
        <div className={styles.vocabulary}>
          {Object.values(INTELLIGENCE_FIELDS).map((field) => (
            <div className={styles.fieldDefinition} key={field.field}>
              <div><strong>{field.label}</strong><code>{field.field}</code></div>
              <span>{field.entity} · {field.unit ?? "unitless"}</span>
              <span>{field.minimumThreshold} to {field.maximumThreshold} · {field.maximumDecimalPlaces} decimals max</span>
              <span>{field.allowedOperators.join(" · ")}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function IntelligenceRulesConsole({ initial, canEdit }: { initial: IntelligenceBootstrap; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("rules");
  const [overview, setOverview] = useState(initial.overview);
  const [selected, setSelected] = useState<IntelligenceRuleSetDetail | null>(initial.selected);
  const [events, setEvents] = useState(initial.events);
  const [compareId, setCompareId] = useState(
    initial.overview.versions.find((version) => version.ruleSetId !== initial.selected?.ruleSetId)?.ruleSetId ?? "",
  );
  const [diff, setDiff] = useState<IntelligenceRuleSetDiff | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [releaseTarget, setReleaseTarget] = useState<ReleaseTarget | null>(null);
  const [releaseConfirmation, setReleaseConfirmation] = useState("");
  const createGesture = useRef<{ signature: string; requestId: string } | null>(null);
  const activateGesture = useRef<{ signature: string; requestId: string } | null>(null);
  const compareEpoch = useRef(0);
  const [draft, setDraft] = useState<CreateIntelligenceVersionInput>({
    label: "",
    changeNote: "",
    basedOnId: initial.selected?.ruleSetId ?? null,
    documentJson: initial.selected ? JsonState(initial.selected.document) : "",
    provenanceJson: initial.selected ? JsonState(initial.selected.provenance) : "[]",
  });

  const selectedSummary = overview.versions.find((item) => item.ruleSetId === selected?.ruleSetId) ?? null;
  const activeSummary = overview.versions.find((item) => item.isActive) ?? null;
  const releaseExpected = releaseTarget
    ? `${releaseTarget.operation.toUpperCase()} v${releaseTarget.version}`
    : "";
  const activeGroups = selected?.document.groups.filter((group) => group.active).length ?? 0;
  const activeRules = selected?.document.rules.filter((rule) => rule.active).length ?? 0;
  const frameworkCount = selected?.document.groups.filter((group) => group.scope === "framework").length ?? 0;
  const tabItems = canEdit ? [...TABS, { id: "new" as const, label: "New version" }] : TABS;

  const provenanceCoverage = useMemo(() => {
    if (!selected?.document.rules.length) return 0;
    return Math.round((selected.provenance.length / selected.document.rules.length) * 100);
  }, [selected]);

  async function reload(preferredId?: string) {
    const response = await getIntelligenceBootstrap();
    if (!response.success) throw new Error(response.error);
    let nextSelected = response.data.selected;
    if (preferredId) {
      const detail = await getIntelligenceRuleSetAction(preferredId);
      if (!detail.success) throw new Error(detail.error);
      nextSelected = detail.data;
    }
    setOverview(response.data.overview);
    setEvents(response.data.events);
    setSelected(nextSelected);
  }

  async function selectVersion(ruleSetId: string) {
    if (ruleSetId === selected?.ruleSetId) return;
    setBusy("select");
    setNotice(null);
    setDiff(null);
    compareEpoch.current += 1;
    setCompareId(overview.versions.find((version) => version.ruleSetId !== ruleSetId)?.ruleSetId ?? "");
    try {
      const response = await getIntelligenceRuleSetAction(ruleSetId);
      if (!response.success) throw new Error(response.error);
      setSelected(response.data);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load the version." });
    } finally {
      setBusy(null);
    }
  }

  async function prepareClone() {
    if (!selected) return;
    setBusy("clone");
    setNotice(null);
    try {
      const response = await getIntelligenceCloneInputAction(selected.ruleSetId);
      if (!response.success) throw new Error(response.error);
      setDraft({
        label: response.data.suggestedLabel,
        changeNote: "",
        basedOnId: response.data.basedOnId,
        documentJson: JsonState(response.data.document),
        provenanceJson: JsonState(response.data.provenance),
      });
      setTab("new");
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not prepare a new version." });
    } finally {
      setBusy(null);
    }
  }

  async function compareVersions() {
    if (!selected || !compareId || compareId === selected.ruleSetId) return;
    const epoch = ++compareEpoch.current;
    const leftRuleSetId = compareId;
    const rightRuleSetId = selected.ruleSetId;
    setBusy("compare");
    setNotice(null);
    try {
      const response = await diffIntelligenceRuleSetsAction(leftRuleSetId, rightRuleSetId);
      if (!response.success) throw new Error(response.error);
      if (compareEpoch.current === epoch) setDiff(response.data);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not compare versions." });
    } finally {
      if (compareEpoch.current === epoch) setBusy(null);
    }
  }

  function requestRelease(version: IntelligenceVersionSummary) {
    if (version.isActive) return;
    const operation: ReleaseOperation = activeSummary && version.version < activeSummary.version
      ? "rollback"
      : "activate";
    setReleaseTarget({
      ruleSetId: version.ruleSetId,
      version: version.version,
      label: version.label,
      operation,
    });
    setReleaseConfirmation("");
    setNotice(null);
  }

  async function releaseVersion() {
    if (!releaseTarget) return;
    if (releaseConfirmation !== releaseExpected) {
      setNotice({ kind: "error", text: `Type ${releaseExpected} exactly to confirm this release.` });
      return;
    }
    const { ruleSetId, version, operation } = releaseTarget;
    const pastTense = operation === "rollback" ? "rolled back" : "activated";
    setBusy(`${operation}:${ruleSetId}`);
    setNotice(null);
    const gestureSignature = `${operation}\u0000${ruleSetId}\u0000${overview.revision}\u0000${releaseExpected}`;
    if (activateGesture.current?.signature !== gestureSignature) {
      activateGesture.current = { signature: gestureSignature, requestId: crypto.randomUUID() };
    }
    const requestId = activateGesture.current.requestId;
    try {
      const response = await activateIntelligenceVersionAction({
        ruleSetId,
        expectedRevision: overview.revision,
        requestId,
        operation,
        version,
        confirmation: releaseConfirmation,
      });
      if (!response.success) throw new Error(response.error);
      try {
        await reload(ruleSetId);
        activateGesture.current = null;
        setReleaseTarget(null);
        setReleaseConfirmation("");
        setNotice({
          kind: "success",
          text: `Version ${response.data.version} was ${pastTense} and is now active at release revision ${response.data.revision}.`,
        });
      } catch (reloadError) {
        setNotice({
          kind: "info",
          text: `Version ${response.data.version} was ${pastTense}, but the page state could not be reconciled. Retry the unchanged ${operation} request to replay it, or reload before another change. ${reloadError instanceof Error ? reloadError.message : ""}`.trim(),
        });
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : `Could not ${operation} the version.` });
    } finally {
      setBusy(null);
    }
  }

  async function createVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setNotice(null);
    const gestureSignature = JSON.stringify(draft);
    if (createGesture.current?.signature !== gestureSignature) {
      createGesture.current = { signature: gestureSignature, requestId: crypto.randomUUID() };
    }
    const requestId = createGesture.current.requestId;
    try {
      const created = await createIntelligenceVersionAction({ ...draft, requestId });
      if (!created.success) throw new Error(created.error);
      try {
        await reload(created.data.ruleSetId);
        createGesture.current = null;
        setTab("versions");
        setNotice({
          kind: "success",
          text: `Version ${created.data.version} was created and remains inactive pending separate review and activation.`,
        });
      } catch (reloadError) {
        setNotice({
          kind: "info",
          text: `Version ${created.data.version} was created, but the page state could not be reconciled. Retry Create with the unchanged form to replay the same request, or reload the page. ${reloadError instanceof Error ? reloadError.message : ""}`.trim(),
        });
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not create the version." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {!canEdit && (
        <div className={styles.viewerNote} role="note">
          <strong>View-only seat.</strong> You can inspect versions, provenance, comparisons and the audit trail. Creation and activation controls are not available.
        </div>
      )}

      {notice && (
        <div className={`${styles.notice} ${styles[notice.kind]}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
          {notice.text}
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <div className="adm-stats" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div className="adm-stat"><span className="adm-stat__label">Live version</span><span className="adm-stat__value">{activeSummary ? `v${activeSummary.version}` : "—"}</span><span className="adm-stat__sub">release revision {overview.revision}</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Selected snapshot</span><span className="adm-stat__value">{selectedSummary ? `v${selectedSummary.version}` : "—"}</span><span className="adm-stat__sub">{selectedSummary?.label ?? "No version"}</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Selected catalogue</span><span className="adm-stat__value">{activeRules}</span><span className="adm-stat__sub">active rules · {activeGroups} groups</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Governance</span><span className="adm-stat__value">{provenanceCoverage}%</span><span className="adm-stat__sub">provenance coverage · {frameworkCount} frameworks</span></div>
      </div>

      <div className={styles.selectionBar}>
        <label className="adm-field">
          <span className="adm-field__label">Inspect version</span>
          <select className="adm-select" value={selected?.ruleSetId ?? ""} onChange={(event) => void selectVersion(event.target.value)} disabled={busy === "select"}>
            {overview.versions.map((version) => (
              <option key={version.ruleSetId} value={version.ruleSetId}>v{version.version} · {version.label}{version.isActive ? " · LIVE" : ""}</option>
            ))}
          </select>
        </label>
        {selected && (
          <div className={styles.selectionMeta}>
            <VersionBadge version={selected.version} active={selected.ruleSetId === overview.activeRuleSetId} />
            <span>SHA-256 <AccessibleIdentifier label={`Version ${selected.version} content SHA-256`} value={selected.contentHash} /></span>
            <span>Created {fmtDate(selected.createdAt)} UTC</span>
            <span>{selected.changeNote}</span>
          </div>
        )}
        {canEdit && selected && <button type="button" className="adm-btn primary" onClick={() => void prepareClone()} disabled={busy !== null}>Create from this version</button>}
      </div>

      <nav className={`adm-tabs ${styles.tabsScroller}`} aria-label="Intelligence rule administration">
        {tabItems.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            className={`adm-tab${tab === item.id ? " is-on" : ""}`}
            onClick={() => {
              if (item.id === "new" && selected && draft.basedOnId !== selected.ruleSetId) void prepareClone();
              else setTab(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section aria-label={tabItems.find((item) => item.id === tab)?.label ?? "Intelligence rules"} tabIndex={0} className={styles.panel}>
        {tab === "rules" && <RulesView detail={selected} />}
        {tab === "frameworks" && <FrameworksView detail={selected} />}
        {tab === "provenance" && <ProvenanceView detail={selected} />}
        {tab === "audit" && <AuditView events={events} />}
        {tab === "new" && canEdit && (
          <NewVersionView
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onSubmit={(event) => void createVersion(event)}
            selected={selected}
            onPrepare={() => void prepareClone()}
          />
        )}
        {tab === "versions" && (
          <div className={styles.stack}>
            <section className="adm-card">
              <div className="adm-card__head">
                <div>
                  <span className="adm-card__title">Published snapshots</span>
                  <span className="adm-card__sub">Versions are append-only. Activate any valid snapshot to release or roll back safely.</span>
                </div>
              </div>
              <div className="adm-table">
                <table style={{ minWidth: 980 }}>
                  <thead><tr><th>Version</th><th>Label & change</th><th>Contents</th><th>Created</th><th>Hash</th><th /></tr></thead>
                  <tbody>
                    {overview.versions.map((version) => (
                      <tr key={version.ruleSetId}>
                        <td><VersionBadge version={version.version} active={version.isActive} /></td>
                        <td><strong>{version.label}</strong><div className={styles.cellMeta}>{version.changeNote}</div></td>
                        <td>{version.groupCount} groups · {version.ruleCount} rules<div className={styles.cellMeta}>schema {version.schemaVersion} · {version.evaluatorVersion}</div></td>
                        <td>{fmtDate(version.createdAt)} UTC<div className={styles.cellMeta} title={version.createdBy ?? undefined}>by {shortId(version.createdBy)}</div></td>
                        <td><AccessibleIdentifier label={`Version ${version.version} content SHA-256`} value={version.contentHash} /></td>
                        <td>
                          <div className={styles.rowActions}>
                            <button type="button" className="adm-btn small" onClick={() => void selectVersion(version.ruleSetId)}>Inspect</button>
                            {canEdit && !version.isActive && (
                              <button type="button" className="adm-btn approve small" onClick={() => requestRelease(version)} disabled={busy !== null}>
                                {activeSummary && version.version < activeSummary.version ? "Roll back" : "Activate"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {releaseTarget && (
                <div className={styles.confirmationPanel} role="group" aria-labelledby="intelligence-release-title">
                  <div>
                    <strong id="intelligence-release-title">
                      {releaseTarget.operation === "rollback" ? "Roll back" : "Activate"} v{releaseTarget.version} · {releaseTarget.label}
                    </strong>
                    <span>
                      This changes live intelligence signals for members. Type <code>{releaseExpected}</code> exactly.
                    </span>
                  </div>
                  <input
                    className="adm-input"
                    aria-label={`Type ${releaseExpected} to confirm the intelligence release`}
                    value={releaseConfirmation}
                    onChange={(event) => setReleaseConfirmation(event.currentTarget.value)}
                    disabled={busy !== null}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className={releaseTarget.operation === "rollback" ? "adm-btn warn" : "adm-btn approve"}
                    onClick={() => void releaseVersion()}
                    disabled={busy !== null || releaseConfirmation !== releaseExpected}
                  >
                    {busy === `${releaseTarget.operation}:${releaseTarget.ruleSetId}`
                      ? releaseTarget.operation === "rollback" ? "Rolling back…" : "Activating…"
                      : `${releaseTarget.operation === "rollback" ? "Roll back" : "Activate"} v${releaseTarget.version}`}
                  </button>
                  <button
                    type="button"
                    className="adm-btn"
                    onClick={() => {
                      setReleaseTarget(null);
                      setReleaseConfirmation("");
                    }}
                    disabled={busy !== null}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </section>

            {overview.versions.length > 1 && selected && (
              <section className="adm-card">
                <div className="adm-card__head">
                  <div>
                    <span className="adm-card__title">Compare with selected v{selected.version}</span>
                    <span className="adm-card__sub">Shows group, rule and provenance keys added, changed or removed.</span>
                  </div>
                </div>
                <div className={styles.compareBar}>
                  <label className="adm-field">
                    <span className="adm-field__label">Earlier / base version</span>
                    <select className="adm-select" value={compareId} onChange={(event) => { setCompareId(event.target.value); setDiff(null); }}>
                      <option value="">Choose a version</option>
                      {overview.versions.filter((version) => version.ruleSetId !== selected.ruleSetId).map((version) => (
                        <option value={version.ruleSetId} key={version.ruleSetId}>v{version.version} · {version.label}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="adm-btn primary" onClick={() => void compareVersions()} disabled={!compareId || busy !== null}>
                    {busy === "compare" ? "Comparing…" : "Compare versions"}
                  </button>
                </div>
              </section>
            )}
            {diff && <DiffPanel diff={diff} versions={overview.versions} />}
          </div>
        )}
      </section>
    </>
  );
}
