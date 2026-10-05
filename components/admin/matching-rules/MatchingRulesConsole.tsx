"use client";

import { useMemo, useRef, useState } from "react";

import {
  activateMatchingRuleVersionAction,
  createMatchingRuleVersionAction,
  getMatchingRulesBootstrap,
  previewMatchingRulesAction,
} from "@/app/(admin)/admin/matching-rules/actions";
import {
  MATCHING_RULES_V1_DEFAULTS,
  safeParseMatchingRulesV1,
  type MatchingRulesV1Payload,
  type MatchScoreLabel,
} from "@/lib/matching-rules";
import type {
  MatchingRuleEvent,
  MatchingRulesDashboard,
  MatchingRulesPreview,
} from "@/sdk/app/matching-rules";
import { AccessibleIdentifier } from "@/components/admin/AccessibleIdentifier";

import styles from "./MatchingRulesConsole.module.css";

type Tab = "parameters" | "versions" | "audit";
type Busy = "preview" | "create" | "activate" | "reload" | null;
type Notice = { kind: "success" | "error" | "info"; text: string } | null;
type RootNumericKey =
  | "dwtTolerancePct"
  | "partCargoTolerancePct"
  | "laycanBeforeDays"
  | "laycanAfterDays"
  | "rateAlignmentUsd";
type ScoreKey = keyof MatchingRulesV1Payload["score"];

interface ActivationTarget {
  versionId: string;
  versionNo: number;
}

interface NumericField<K extends string> {
  key: K;
  label: string;
  help: string;
  minimum: number;
  maximum: number;
  step: number;
  unit: string;
}

const ROOT_FIELDS: readonly NumericField<RootNumericKey>[] = [
  {
    key: "dwtTolerancePct",
    label: "DWT tolerance",
    help: "Standard capacity window around the cargo quantity.",
    minimum: 0,
    maximum: 50,
    step: 1,
    unit: "%",
  },
  {
    key: "partCargoTolerancePct",
    label: "Part-cargo tolerance",
    help: "Wider capacity window when the vessel accepts part cargo.",
    minimum: 0,
    maximum: 50,
    step: 1,
    unit: "%",
  },
  {
    key: "laycanBeforeDays",
    label: "Laycan before",
    help: "Days a vessel may open before the cargo laycan.",
    minimum: 0,
    maximum: 90,
    step: 1,
    unit: "days",
  },
  {
    key: "laycanAfterDays",
    label: "Laycan after",
    help: "Days a vessel may open after the cargo laycan.",
    minimum: 0,
    maximum: 90,
    step: 1,
    unit: "days",
  },
  {
    key: "rateAlignmentUsd",
    label: "Rate alignment",
    help: "Maximum freight-idea difference used by ranking.",
    minimum: 0,
    maximum: 1_000,
    step: 0.01,
    unit: "USD/MT",
  },
];

const SCORE_FIELDS: readonly NumericField<ScoreKey>[] = [
  {
    key: "dwtTight",
    label: "DWT tight fit",
    help: "Points for a vessel close to full cargo utilization.",
    minimum: 0,
    maximum: 20,
    step: 1,
    unit: "points",
  },
  {
    key: "dwtLoose",
    label: "DWT loose fit",
    help: "Points for an eligible but looser capacity fit.",
    minimum: 0,
    maximum: 20,
    step: 1,
    unit: "points",
  },
  {
    key: "zoneLoad",
    label: "Load-zone match",
    help: "Points when the vessel opens in the cargo load zone.",
    minimum: 0,
    maximum: 20,
    step: 1,
    unit: "points",
  },
  {
    key: "zoneDisch",
    label: "Discharge-zone match",
    help: "Points for the matching discharge-zone branch.",
    minimum: 0,
    maximum: 20,
    step: 1,
    unit: "points",
  },
  {
    key: "gear",
    label: "Gear match",
    help: "Points when vessel gear satisfies the cargo requirement.",
    minimum: 0,
    maximum: 20,
    step: 1,
    unit: "points",
  },
];

const LABELS: readonly MatchScoreLabel[] = ["Possible", "Good", "Strong"];
const COUNT_FORMATTER = new Intl.NumberFormat("en-US");

function cloneRules(rules: MatchingRulesV1Payload): MatchingRulesV1Payload {
  return {
    schemaVersion: 1,
    dwtTolerancePct: rules.dwtTolerancePct,
    partCargoTolerancePct: rules.partCargoTolerancePct,
    laycanBeforeDays: rules.laycanBeforeDays,
    laycanAfterDays: rules.laycanAfterDays,
    rateAlignmentUsd: rules.rateAlignmentUsd,
    minScoreLabel: rules.minScoreLabel,
    score: {
      dwtTight: rules.score.dwtTight,
      dwtLoose: rules.score.dwtLoose,
      zoneLoad: rules.score.zoneLoad,
      zoneDisch: rules.score.zoneDisch,
      gear: rules.score.gear,
    },
  };
}

function rulesSignature(rules: MatchingRulesV1Payload): string {
  return JSON.stringify(rules);
}

function changedParameterCount(current: MatchingRulesV1Payload, proposed: MatchingRulesV1Payload): number {
  let count = current.minScoreLabel === proposed.minScoreLabel ? 0 : 1;
  for (const field of ROOT_FIELDS) {
    if (current[field.key] !== proposed[field.key]) count += 1;
  }
  for (const field of SCORE_FIELDS) {
    if (current.score[field.key] !== proposed.score[field.key]) count += 1;
  }
  return count;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function shortHash(value: string | null, length = 12): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function formatCount(value: number): string {
  return COUNT_FORMATTER.format(value);
}

function NoticeBar({ notice, dismiss }: { notice: Notice; dismiss: () => void }) {
  if (!notice) return null;
  return (
    <div
      className={`${styles.notice} ${styles[notice.kind]}`}
      role={notice.kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span>{notice.text}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss notification">×</button>
    </div>
  );
}

function EvidenceHash({ label, value }: { label: string; value: string | null }) {
  return (
    <div className={styles.hashLine}>
      <span>{label}</span>
      <AccessibleIdentifier label={`${label} hash`} value={value} />
    </div>
  );
}

function PreviewPanel({ preview }: { preview: MatchingRulesPreview }) {
  const difference = preview.proposedCandidateCount - preview.currentCandidateCount;
  return (
    <section className={`${styles.preview} adm-card`} aria-labelledby="matching-preview-title">
      <div className="adm-card__head">
        <div>
          <span className="adm-card__title" id="matching-preview-title">Publication preview</span>
          <span className="adm-card__sub">Read-only evaluation against the current governed source rows.</span>
        </div>
        <span className="adm-badge current">As of {preview.asOfYear}</span>
      </div>
      <div className={styles.previewGrid}>
        <div><span>Current candidates</span><strong>{formatCount(preview.currentCandidateCount)}</strong></div>
        <div><span>Proposed candidates</span><strong>{formatCount(preview.proposedCandidateCount)}</strong></div>
        <div><span>Added pairs</span><strong className={styles.positive}>+{formatCount(preview.addedCount)}</strong></div>
        <div><span>Removed pairs</span><strong className={preview.removedCount ? styles.negative : ""}>−{formatCount(preview.removedCount)}</strong></div>
      </div>
      <p className={styles.previewSummary}>
        Net candidate change: <strong>{difference > 0 ? "+" : ""}{formatCount(difference)}</strong>.
        A successful activation will rebuild the complete live cache atomically.
      </p>
      <div className={styles.hashGrid}>
        <EvidenceHash label="Current parameter hash" value={preview.activeParamsSha256} />
        <EvidenceHash label="Proposed parameter hash" value={preview.proposedParamsSha256} />
      </div>
    </section>
  );
}

function AuditTable({ events }: { events: MatchingRuleEvent[] }) {
  if (!events.length) return <div className="adm-empty">No matching-rule events have been recorded.</div>;
  return (
    <section className="adm-card" aria-labelledby="matching-audit-title">
      <div className="adm-card__head">
        <div>
          <span className="adm-card__title" id="matching-audit-title">Immutable audit trail</span>
          <span className="adm-card__sub">Version creation and publication evidence retained by the database.</span>
        </div>
      </div>
      <div className="adm-table">
        <table className={styles.auditTable}>
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Version</th>
              <th scope="col">Candidates</th>
              <th scope="col">Hashes</th>
              <th scope="col">Actor / request</th>
              <th scope="col">Occurred (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="no-hover">
                <td>
                  <strong>{event.eventType.replaceAll("_", " ")}</strong>
                  <div className={styles.cellMeta}>Event #{event.id}{event.asOfYear ? ` · as of ${event.asOfYear}` : ""}</div>
                </td>
                <td><code title={event.versionId ?? undefined}>{shortHash(event.versionId, 8)}</code></td>
                <td className="num">{event.candidateCount === null ? "—" : formatCount(event.candidateCount)}</td>
                <td>
                  <EvidenceHash label="Params" value={event.paramsSha256} />
                  <EvidenceHash label="Candidates" value={event.candidateSha256} />
                  <EvidenceHash label="Sources" value={event.sourceSha256} />
                </td>
                <td>
                  <code title={event.actorId ?? undefined}>{shortHash(event.actorId, 8)}</code>
                  <div className={styles.cellMeta} title={event.requestId ?? undefined}>Request {shortHash(event.requestId, 8)}</div>
                </td>
                <td>{formatDate(event.occurredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MatchingRulesConsole({
  initial,
  canEdit,
}: {
  initial: MatchingRulesDashboard;
  canEdit: boolean;
}) {
  const [dashboard, setDashboard] = useState(initial);
  const [tab, setTab] = useState<Tab>("parameters");
  const [rules, setRules] = useState<MatchingRulesV1Payload>(() => cloneRules(initial.activeVersion.params));
  const [changeNote, setChangeNote] = useState("");
  const [preview, setPreview] = useState<MatchingRulesPreview | null>(null);
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
  const [target, setTarget] = useState<ActivationTarget | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const createGesture = useRef<{ signature: string; requestId: string } | null>(null);
  const activateGesture = useRef<{ signature: string; requestId: string } | null>(null);

  const active = dashboard.activeVersion;
  const signature = rulesSignature(rules);
  const modifiedCount = useMemo(
    () => changedParameterCount(active.params, rules),
    [active.params, rules],
  );
  const validation = useMemo(() => safeParseMatchingRulesV1(rules), [rules]);
  const validationIssues = validation.success ? [] : validation.issues;
  const previewIsCurrent = Boolean(
    preview
      && previewSignature === signature
      && preview.activeVersionId === dashboard.state.activeVersionId,
  );
  const targetVersion = target
    ? dashboard.versionHistory.find((version) => version.id === target.versionId) ?? null
    : null;
  const latestActivation = dashboard.recentEvents.find(
    (event) => event.eventType === "version_activated" && event.versionId === dashboard.state.activeVersionId,
  );
  const annualRepublish = Boolean(
    previewIsCurrent && preview && preview.asOfYear !== dashboard.state.asOfYear,
  );
  const hasEffectivePublicationChange = modifiedCount > 0 || annualRepublish;

  function hasValidationIssue(path: string): boolean {
    return validationIssues.some((issue) => issue.path === path || issue.path.startsWith(`${path}.`));
  }

  function invalidatePublicationEvidence() {
    if (target) setChangeNote("");
    setPreview(null);
    setPreviewSignature(null);
    setTarget(null);
  }

  function updateRoot(key: RootNumericKey, value: number) {
    setRules((current) => ({ ...current, [key]: value }));
    invalidatePublicationEvidence();
  }

  function updateScore(key: ScoreKey, value: number) {
    setRules((current) => ({ ...current, score: { ...current.score, [key]: value } }));
    invalidatePublicationEvidence();
  }

  function updateLabel(value: MatchScoreLabel) {
    setRules((current) => ({ ...current, minScoreLabel: value }));
    invalidatePublicationEvidence();
  }

  async function reloadDashboard(): Promise<MatchingRulesDashboard> {
    const response = await getMatchingRulesBootstrap();
    if (!response.success) throw new Error(response.error);
    setDashboard(response.data);
    return response.data;
  }

  async function handleReload() {
    setBusy("reload");
    setNotice(null);
    try {
      const fresh = await reloadDashboard();
      setRules(cloneRules(fresh.activeVersion.params));
      setChangeNote("");
      setPreview(null);
      setPreviewSignature(null);
      setTarget(null);
      setNotice({ kind: "success", text: "Matching-rule state reloaded." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not reload matching rules." });
    } finally {
      setBusy(null);
    }
  }

  async function handlePreview() {
    if (!validation.success) {
      setNotice({
        kind: "error",
        text: validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      });
      return;
    }
    setBusy("preview");
    setNotice(null);
    try {
      const response = await previewMatchingRulesAction(rules);
      if (!response.success) throw new Error(response.error);
      setPreview(response.data);
      setPreviewSignature(signature);
      setNotice({ kind: "success", text: "Preview completed. Review the candidate impact before creating or activating a version." });
    } catch (error) {
      setPreview(null);
      setPreviewSignature(null);
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not preview matching rules." });
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    if (!previewIsCurrent) {
      setNotice({ kind: "error", text: "Run a fresh preview before creating a version." });
      return;
    }
    if (!hasEffectivePublicationChange) {
      setNotice({
        kind: "error",
        text: "No parameter or evaluation-year change is available to publish. Adjust a parameter before creating a version.",
      });
      return;
    }
    if (!changeNote.trim()) {
      setNotice({ kind: "error", text: "Add a change note before creating a version." });
      return;
    }
    setBusy("create");
    setNotice(null);
    const gestureSignature = `${signature}\u0000${changeNote.trim()}`;
    if (createGesture.current?.signature !== gestureSignature) {
      createGesture.current = { signature: gestureSignature, requestId: crypto.randomUUID() };
    }
    const requestId = createGesture.current.requestId;
    try {
      const response = await createMatchingRuleVersionAction({
        params: rules,
        changeNote,
        requestId,
      });
      if (!response.success) throw new Error(response.error);
      setTarget({ versionId: response.data.versionId, versionNo: response.data.versionNo });
      setNotice({
        kind: "success",
        text: `Version v${response.data.versionNo} was created and remains inactive. Activate it explicitly after the final review.`,
      });
      try {
        await reloadDashboard();
        createGesture.current = null;
      } catch (reloadError) {
        setNotice({
          kind: "info",
          text: `Version v${response.data.versionNo} was created, but history could not be reconciled. Retry Create with the unchanged form to replay the same request, or reload the page. ${reloadError instanceof Error ? reloadError.message : ""}`.trim(),
        });
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not create the version." });
    } finally {
      setBusy(null);
    }
  }

  async function handleActivate() {
    if (!target || !previewIsCurrent) {
      setNotice({ kind: "error", text: "Select a newer version and run a fresh preview before activation." });
      return;
    }
    if (!hasEffectivePublicationChange) {
      setNotice({
        kind: "error",
        text: "This target is identical to the live rules for the current evaluation year and cannot be activated.",
      });
      return;
    }
    if (!window.confirm(
      `Activate matching rules v${target.versionNo}? This will atomically rebuild the live candidate cache for members.`,
    )) return;

    setBusy("activate");
    setNotice(null);
    const gestureSignature = `${target.versionId}\u0000${dashboard.state.activeVersionId}`;
    if (activateGesture.current?.signature !== gestureSignature) {
      activateGesture.current = { signature: gestureSignature, requestId: crypto.randomUUID() };
    }
    const requestId = activateGesture.current.requestId;
    try {
      const response = await activateMatchingRuleVersionAction({
        versionId: target.versionId,
        expectedActiveVersionId: dashboard.state.activeVersionId,
        requestId,
      });
      if (!response.success) throw new Error(response.error);
      setNotice({
        kind: "success",
        text: `Version v${response.data.versionNo} is live with ${formatCount(response.data.candidateCount)} candidates (as of ${response.data.asOfYear}).`,
      });
      try {
        const fresh = await reloadDashboard();
        activateGesture.current = null;
        setTarget(null);
        setPreview(null);
        setPreviewSignature(null);
        setChangeNote("");
        setRules(cloneRules(fresh.activeVersion.params));
      } catch (reloadError) {
        setNotice({
          kind: "info",
          text: `Version v${response.data.versionNo} was activated, but the page state could not be reconciled. Retry Activate to replay the same request, or reload before making another change. ${reloadError instanceof Error ? reloadError.message : ""}`.trim(),
        });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: `${error instanceof Error ? error.message : "Could not activate the version."} Reload if the active version changed or retry if the matcher was busy.`,
      });
    } finally {
      setBusy(null);
    }
  }

  function loadVersion(versionId: string) {
    const version = dashboard.versionHistory.find((entry) => entry.id === versionId);
    if (!version) return;
    setRules(cloneRules(version.params));
    setChangeNote(version.versionNo > active.versionNo ? version.note ?? "" : "");
    setPreview(null);
    setPreviewSignature(null);
    setTarget(version.versionNo > active.versionNo
      ? { versionId: version.id, versionNo: version.versionNo }
      : null);
    setTab("parameters");
    setNotice({
      kind: "info",
      text: version.versionNo > active.versionNo
        ? `Loaded inactive v${version.versionNo}. Run a fresh preview before activation.`
        : `Loaded v${version.versionNo} parameters for review. To reuse them, create a new forward version after previewing.`,
    });
  }

  function resetDefaults() {
    if (!window.confirm("Reset every control to the governed v1 defaults? This does not publish anything.")) return;
    setRules(cloneRules(MATCHING_RULES_V1_DEFAULTS));
    setChangeNote("");
    invalidatePublicationEvidence();
    setNotice({ kind: "info", text: "All controls were reset to the v1 defaults. Run a preview before creating a version." });
  }

  function resetActive() {
    setRules(cloneRules(active.params));
    setChangeNote("");
    invalidatePublicationEvidence();
    setNotice({ kind: "info", text: `Controls restored to live version v${active.versionNo}.` });
  }

  return (
    <>
      <NoticeBar notice={notice} dismiss={() => setNotice(null)} />

      {!canEdit && (
        <div className={styles.viewerNote} role="note">
          This session can inspect matching rules but cannot create or activate a version.
        </div>
      )}

      <div className={styles.stats}>
        <div className="adm-stat">
          <span className="adm-stat__label">Live version</span>
          <span className="adm-stat__value">v{active.versionNo}</span>
          <span className="adm-stat__sub">{active.evaluatorVersion} · schema v{active.schemaVersion}</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__label">Activation sequence</span>
          <span className="adm-stat__value">{dashboard.state.activationSequence}</span>
          <span className="adm-stat__sub">Published {formatDate(dashboard.state.activatedAt)}</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__label">Evaluation year</span>
          <span className="adm-stat__value">{dashboard.state.asOfYear}</span>
          <span className="adm-stat__sub">Bound into candidate and source evidence</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__label">Modified parameters</span>
          <span className={`adm-stat__value ${modifiedCount ? "is-amber" : ""}`}>{modifiedCount}</span>
          <span className="adm-stat__sub">Compared with the live version</span>
        </div>
      </div>

      <nav className="adm-tabs" aria-label="Matching-rule administration">
        {([
          ["parameters", "Parameters"],
          ["versions", "Version history"],
          ["audit", "Audit evidence"],
        ] as const).map(([id, label]) => (
          <button
            type="button"
            aria-pressed={tab === id}
            className={`adm-tab ${tab === id ? "is-on" : ""}`}
            onClick={() => setTab(id)}
            key={id}
          >
            {label}
            {id === "versions" && <span className="adm-tab__count">{dashboard.versionHistory.length}</span>}
            {id === "audit" && <span className="adm-tab__count">{dashboard.recentEvents.length}</span>}
          </button>
        ))}
      </nav>

      <div
        className={styles.panel}
        role="region"
        tabIndex={0}
        id="matching-rules-panel"
        aria-label={`${tab === "parameters" ? "Parameters" : tab === "versions" ? "Version history" : "Audit evidence"} panel`}
      >
        {tab === "parameters" && (
          <div className={styles.stack}>
            <section className="adm-card" aria-labelledby="matching-parameter-title">
              <div className="adm-card__head">
                <div>
                  <span className="adm-card__title" id="matching-parameter-title">Matching v1 parameters</span>
                  <span className="adm-card__sub">Every effective field is shown; no hidden UI-only tuning values are added.</span>
                </div>
                <div className={styles.toolbar}>
                  <span className="adm-badge live">Live v{active.versionNo}</span>
                  {target && <span className="adm-badge draft">Target v{target.versionNo}</span>}
                  {canEdit && (
                    <>
                      <button type="button" className="adm-btn small" onClick={resetActive} disabled={busy !== null}>Restore live</button>
                      <button type="button" className="adm-btn small" onClick={resetDefaults} disabled={busy !== null}>Reset defaults</button>
                    </>
                  )}
                </div>
              </div>

              <div className={styles.schemaLine}>
                <span>Schema version</span><strong>1</strong>
                <span>Live parameter hash</span><AccessibleIdentifier label="Live parameter SHA-256" value={active.paramsSha256} />
              </div>

              <div className={styles.ruleGroups}>
                <div>
                  <h3>Eligibility and ranking windows</h3>
                  <div className={styles.parameterGrid}>
                    {ROOT_FIELDS.map((field) => (
                      <label className={styles.parameter} key={field.key} htmlFor={`matching-${field.key}`}>
                        <span className={styles.parameterHead}><strong>{field.label}</strong><span>{field.unit}</span></span>
                        <span className={styles.help}>{field.help}</span>
                        <input
                          id={`matching-${field.key}`}
                          className="adm-input"
                          type="number"
                          min={field.minimum}
                          max={field.maximum}
                          step={field.step}
                          value={rules[field.key]}
                          aria-invalid={hasValidationIssue(`$.${field.key}`)}
                          disabled={!canEdit || busy !== null}
                          onChange={(event) => {
                            const next = event.currentTarget.valueAsNumber;
                            if (Number.isFinite(next)) updateRoot(field.key, next);
                          }}
                        />
                        <span className={styles.referenceValues}>
                          Current <b>{active.params[field.key]}</b> · Default <b>{MATCHING_RULES_V1_DEFAULTS[field.key]}</b>
                        </span>
                        <span className={styles.limits}>{field.minimum}–{field.maximum}, step {field.step}</span>
                      </label>
                    ))}
                    <label className={styles.parameter} htmlFor="matching-min-score-label">
                      <span className={styles.parameterHead}><strong>Minimum score label</strong><span>label</span></span>
                      <span className={styles.help}>Lowest eligible label retained by the matching funnel.</span>
                      <select
                        id="matching-min-score-label"
                        className="adm-select"
                        value={rules.minScoreLabel}
                        disabled={!canEdit || busy !== null}
                        onChange={(event) => updateLabel(event.currentTarget.value as MatchScoreLabel)}
                      >
                        {LABELS.map((label) => <option value={label} key={label}>{label}</option>)}
                      </select>
                      <span className={styles.referenceValues}>
                        Current <b>{active.params.minScoreLabel}</b> · Default <b>{MATCHING_RULES_V1_DEFAULTS.minScoreLabel}</b>
                      </span>
                      <span className={styles.limits}>Possible, Good or Strong</span>
                    </label>
                  </div>
                </div>

                <div>
                  <h3>Score weights</h3>
                  <div className={styles.parameterGrid}>
                    {SCORE_FIELDS.map((field) => (
                      <label className={styles.parameter} key={field.key} htmlFor={`matching-score-${field.key}`}>
                        <span className={styles.parameterHead}><strong>{field.label}</strong><span>{field.unit}</span></span>
                        <span className={styles.help}>{field.help}</span>
                        <input
                          id={`matching-score-${field.key}`}
                          className="adm-input"
                          type="number"
                          min={field.minimum}
                          max={field.maximum}
                          step={field.step}
                          value={rules.score[field.key]}
                          aria-invalid={hasValidationIssue(`$.score.${field.key}`) || hasValidationIssue("$.score")}
                          disabled={!canEdit || busy !== null}
                          onChange={(event) => {
                            const next = event.currentTarget.valueAsNumber;
                            if (Number.isFinite(next)) updateScore(field.key, next);
                          }}
                        />
                        <span className={styles.referenceValues}>
                          Current <b>{active.params.score[field.key]}</b> · Default <b>{MATCHING_RULES_V1_DEFAULTS.score[field.key]}</b>
                        </span>
                        <span className={styles.limits}>{field.minimum}–{field.maximum}, step {field.step}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              {validationIssues.length > 0 && (
                <div className={styles.validation} role="alert">
                  <strong>Correct these parameters before previewing:</strong>
                  <ul>
                    {validationIssues.map((issue) => (
                      <li key={`${issue.path}-${issue.code}`}>{issue.path}: {issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {canEdit && (
              <section className="adm-card" aria-labelledby="matching-release-title">
                <div className="adm-card__head">
                  <div>
                    <span className="adm-card__title" id="matching-release-title">Safe publication</span>
                    <span className="adm-card__sub">Preview → immutable version → explicit activation.</span>
                  </div>
                </div>
                <label className="adm-field" htmlFor="matching-change-note">
                  <span className="adm-field__label">Mandatory change note</span>
                  <textarea
                    id="matching-change-note"
                    className="adm-textarea"
                    required
                    maxLength={1_000}
                    value={changeNote}
                    onChange={(event) => setChangeNote(event.currentTarget.value)}
                    disabled={busy !== null || Boolean(target)}
                    placeholder={target
                      ? "This immutable version already has its recorded change note."
                      : "Explain why these matching parameters should change and what was reviewed."}
                  />
                  <span className={styles.characterCount}>{Array.from(changeNote).length}/1,000</span>
                </label>
                <div className={styles.releaseRow}>
                  <div>
                    <strong>{modifiedCount} parameter{modifiedCount === 1 ? "" : "s"} modified</strong>
                    <span>
                      {validationIssues.length
                        ? "Correct the validation issues before previewing."
                        : previewIsCurrent
                          ? hasEffectivePublicationChange
                            ? annualRepublish
                              ? "Preview is current; annual evaluation-year republish is available."
                              : "Preview is current."
                            : "Preview is current, but there is no publishable change for this year."
                          : "A fresh preview is required."}
                    </span>
                  </div>
                  <button type="button" className="adm-btn primary" onClick={() => void handlePreview()} disabled={busy !== null || !validation.success}>
                    {busy === "preview" ? "Previewing…" : "Preview impact"}
                  </button>
                  {target ? (
                    <button
                      type="button"
                      className="adm-btn approve"
                      onClick={() => void handleActivate()}
                      disabled={busy !== null || !previewIsCurrent || !hasEffectivePublicationChange}
                    >
                      {busy === "activate" ? "Activating…" : `Activate v${target.versionNo}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="adm-btn warn"
                      onClick={() => void handleCreate()}
                      disabled={busy !== null || !previewIsCurrent || !hasEffectivePublicationChange || !changeNote.trim()}
                    >
                      {busy === "create" ? "Creating…" : "Create immutable version"}
                    </button>
                  )}
                </div>
                {target && (
                  <p className={styles.targetNote}>
                    Target v{target.versionNo} ({targetVersion?.note ?? "newly created"}) remains inactive until you confirm activation.
                  </p>
                )}
              </section>
            )}

            {preview && previewIsCurrent && <PreviewPanel preview={preview} />}
          </div>
        )}

        {tab === "versions" && (
          <section className="adm-card" aria-labelledby="matching-version-title">
            <div className="adm-card__head">
              <div>
                <span className="adm-card__title" id="matching-version-title">Version history</span>
                <span className="adm-card__sub">Versions are immutable. Activation is forward-only; reuse older values by creating a new version.</span>
              </div>
              <button type="button" className="adm-btn small" onClick={() => void handleReload()} disabled={busy !== null}>
                {busy === "reload" ? "Reloading…" : "Reload"}
              </button>
            </div>
            <div className="adm-table">
              <table className={styles.versionTable}>
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Note</th>
                    <th scope="col">Parameter hash</th>
                    <th scope="col">Created (UTC)</th>
                    <th scope="col"><span className={styles.srOnly}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.versionHistory.map((version) => {
                    const isActive = version.id === dashboard.state.activeVersionId;
                    const isPrevious = version.id === dashboard.state.previousVersionId;
                    return (
                      <tr key={version.id} className="no-hover">
                        <td>
                          <strong>v{version.versionNo}</strong>{" "}
                          <span className={`adm-badge ${isActive ? "live" : "draft"}`}>{isActive ? "Live" : "Inactive"}</span>
                          {isPrevious && <span className="adm-badge current">Previous</span>}
                          <div className={styles.cellMeta}>{version.evaluatorVersion} · schema v{version.schemaVersion}</div>
                        </td>
                        <td className={styles.noteCell}>{version.note ?? "—"}</td>
                        <td><AccessibleIdentifier label={`Version ${version.versionNo} parameter SHA-256`} value={version.paramsSha256} /></td>
                        <td>{formatDate(version.createdAt)}</td>
                        <td>{canEdit ? (
                          <button
                            type="button"
                            className="adm-btn small"
                            onClick={() => loadVersion(version.id)}
                            disabled={busy !== null}
                          >
                            {version.versionNo > active.versionNo ? "Review for activation" : "Load parameters"}
                          </button>
                        ) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "audit" && (
          <div className={styles.stack}>
            <section className="adm-card" aria-labelledby="matching-evidence-title">
              <div className="adm-card__head">
                <div>
                  <span className="adm-card__title" id="matching-evidence-title">Live publication evidence</span>
                  <span className="adm-card__sub">Evidence hashes make the parameter, source and candidate snapshots independently identifiable.</span>
                </div>
              </div>
              <div className={styles.evidenceGrid}>
                <EvidenceHash label="Active parameters" value={active.paramsSha256} />
                <EvidenceHash label="Candidate snapshot" value={latestActivation?.candidateSha256 ?? null} />
                <EvidenceHash label="Source snapshot" value={latestActivation?.sourceSha256 ?? null} />
                <div className={styles.hashLine}><span>As-of year</span><strong>{latestActivation?.asOfYear ?? dashboard.state.asOfYear}</strong></div>
              </div>
            </section>
            <AuditTable events={dashboard.recentEvents} />
          </div>
        )}
      </div>
    </>
  );
}
