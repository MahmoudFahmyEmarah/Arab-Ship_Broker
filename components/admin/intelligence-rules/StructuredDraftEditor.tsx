"use client";

import { useMemo, useState } from "react";

import { INTELLIGENCE_FIELDS } from "@/lib/intelligence";
import type {
  IntelligenceEntity,
  IntelligenceGroupScope,
  IntelligenceOperator,
  IntelligenceProvenanceEntryV1,
  IntelligenceRuleGroupV1,
  IntelligenceRuleSetDocumentV1,
  IntelligenceRuleV1,
  IntelligenceSeverity,
  IntelligenceThreshold,
} from "@/lib/intelligence";

import styles from "./IntelligenceRulesConsole.module.css";

interface Props {
  documentJson: string;
  provenanceJson: string;
  disabled: boolean;
  onDocumentChange: (value: string) => void;
  onProvenanceChange: (value: string) => void;
}

type EditorSection = "rules" | "groups" | "frameworks" | "provenance";

const OPERATORS: readonly IntelligenceOperator[] = ["lt", "gt", "eq", "ne", "between", "missing"];
const SEVERITIES: readonly IntelligenceSeverity[] = ["good", "info", "warning", "danger"];
const SCOPES: readonly Exclude<IntelligenceGroupScope, "framework">[] = ["cargo", "vessel", "both"];

function decodeDocument(value: string): IntelligenceRuleSetDocumentV1 | null {
  try {
    const candidate = JSON.parse(value) as Partial<IntelligenceRuleSetDocumentV1>;
    return candidate && Array.isArray(candidate.groups) && Array.isArray(candidate.rules)
      ? candidate as IntelligenceRuleSetDocumentV1
      : null;
  } catch {
    return null;
  }
}

function decodeProvenance(value: string): IntelligenceProvenanceEntryV1[] | null {
  try {
    const candidate = JSON.parse(value) as unknown;
    return Array.isArray(candidate) ? candidate as IntelligenceProvenanceEntryV1[] : null;
  } catch {
    return null;
  }
}

function encode(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function nextCode(prefix: string, used: ReadonlySet<string>): string {
  for (let index = 1; index < 10_000; index += 1) {
    const code = `${prefix}${String(index).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
  return `${prefix}${Date.now()}`;
}

function numberValue(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function thresholdFor(operator: IntelligenceOperator, previous: IntelligenceThreshold): IntelligenceThreshold {
  if (operator === "missing") return null;
  if (operator === "between") {
    if (Array.isArray(previous)) return [previous[0], previous[1]];
    const number = typeof previous === "number" ? previous : 0;
    return [number, number];
  }
  if (Array.isArray(previous)) return previous[0];
  return typeof previous === "number" ? previous : 0;
}

function Toggle({ checked, disabled, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.toggleLabel}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function StructuredDraftEditor({
  documentJson,
  provenanceJson,
  disabled,
  onDocumentChange,
  onProvenanceChange,
}: Props) {
  const [section, setSection] = useState<EditorSection>("rules");
  const document = useMemo(() => decodeDocument(documentJson), [documentJson]);
  const provenance = useMemo(() => decodeProvenance(provenanceJson), [provenanceJson]);

  if (!document || !provenance) {
    return (
      <div className={styles.editorError} role="alert">
        The cloned rule snapshot could not be opened by the structured editor. Reset it from the selected version.
      </div>
    );
  }

  const operationalGroups = document.groups.filter((group) => group.scope !== "framework");
  const frameworks = document.groups.filter((group) => group.scope === "framework");

  const updateDocument = (next: IntelligenceRuleSetDocumentV1) => onDocumentChange(encode(next));
  const updateGroups = (groups: readonly IntelligenceRuleGroupV1[]) => updateDocument({ ...document, groups });
  const updateRules = (rules: readonly IntelligenceRuleV1[]) => updateDocument({ ...document, rules });

  const patchGroup = (code: string, patch: Partial<IntelligenceRuleGroupV1>) => {
    const previous = document.groups.find((group) => group.code === code);
    if (!previous) return;
    const nextCodeValue = patch.code ?? code;
    updateGroups(document.groups.map((group) => group.code === code ? { ...group, ...patch } : group));
    if (nextCodeValue !== code) {
      updateDocument({
        ...document,
        groups: document.groups.map((group) => group.code === code ? { ...group, ...patch } : group),
        rules: document.rules.map((rule) => rule.group === code ? { ...rule, group: nextCodeValue } : rule),
      });
    }
  };

  const removeGroup = (code: string) => {
    if (document.rules.some((rule) => rule.group === code)) return;
    updateGroups(document.groups.filter((group) => group.code !== code));
  };

  const addGroup = (scope: IntelligenceGroupScope) => {
    const used = new Set(document.groups.map((group) => group.code));
    const prefix = scope === "framework" ? "framework_" : "group_";
    const code = nextCode(prefix, used).toLowerCase();
    updateGroups([
      ...document.groups,
      {
        code,
        name: scope === "framework" ? "New framework" : "New rule group",
        description: "Describe the governed purpose of this group.",
        scope,
        active: false,
        priority: document.groups.reduce((max, item) => Math.max(max, item.priority), 0) + 10,
      },
    ]);
  };

  const patchRule = (code: string, patch: Partial<IntelligenceRuleV1>) => {
    const nextCodeValue = patch.code ?? code;
    updateRules(document.rules.map((rule) => rule.code === code ? { ...rule, ...patch } : rule));
    if (nextCodeValue !== code) {
      onProvenanceChange(encode(provenance.map((entry) => entry.ruleCode === code
        ? { ...entry, ruleCode: nextCodeValue }
        : entry)));
    }
  };

  const removeRule = (code: string) => {
    updateRules(document.rules.filter((rule) => rule.code !== code));
    onProvenanceChange(encode(provenance.filter((entry) => entry.ruleCode !== code)));
  };

  const addRule = () => {
    const group = operationalGroups[0];
    if (!group) return;
    const entity: IntelligenceEntity = group.scope === "vessel" ? "vessel" : "cargo";
    const field = Object.values(INTELLIGENCE_FIELDS).find((candidate) => candidate.entity === entity);
    if (!field) return;
    const code = nextCode("R-", new Set(document.rules.map((rule) => rule.code)));
    updateRules([
      ...document.rules,
      {
        code,
        group: group.code,
        entity,
        field: field.field,
        operator: "missing",
        threshold: null,
        severity: "info",
        tag: "Review",
        message: "Observed data requires verification.",
        signalKey: `review.${field.field}.${code.toLowerCase()}`,
        active: false,
        priority: document.rules.reduce((max, item) => Math.max(max, item.priority), 0) + 10,
      },
    ]);
  };

  const patchProvenance = (ruleCode: string, patch: Partial<IntelligenceProvenanceEntryV1>) => {
    const existing = provenance.find((entry) => entry.ruleCode === ruleCode);
    const next = existing
      ? provenance.map((entry) => entry.ruleCode === ruleCode ? { ...entry, ...patch } : entry)
      : [...provenance, {
          ruleCode,
          sourceRef: "Source pending",
          originalMessage: document.rules.find((rule) => rule.code === ruleCode)?.message ?? "Original guidance pending",
          note: null,
          ...patch,
        }];
    onProvenanceChange(encode(next));
  };

  return (
    <div className={styles.structuredEditor}>
      <div className={styles.editorTabs} role="tablist" aria-label="Version contents">
        {([
          ["rules", `Rules (${document.rules.length})`],
          ["groups", `Groups (${operationalGroups.length})`],
          ["frameworks", `Frameworks (${frameworks.length})`],
          ["provenance", `Provenance (${provenance.length})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={section === id ? styles.editorTabActive : styles.editorTab}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "rules" && (
        <section className={styles.structuredSection} aria-label="Rules editor">
          <div className={styles.structuredHead}>
            <div><strong>Rule catalogue</strong><span>All conditions use the closed field and operator vocabulary.</span></div>
            <button type="button" className="adm-btn small" disabled={disabled || !operationalGroups.length} onClick={addRule}>Add rule</button>
          </div>
          {!document.rules.length && <div className="adm-empty">No rules in this draft.</div>}
          {document.rules.map((rule) => {
            const fields = Object.values(INTELLIGENCE_FIELDS).filter((field) => field.entity === rule.entity);
            const groups = operationalGroups.filter((group) => group.scope === "both" || group.scope === rule.entity);
            return (
              <article className={styles.ruleEditorCard} key={document.rules.indexOf(rule)}>
                <div className={styles.ruleEditorHead}>
                  <label className="adm-field"><span className="adm-field__label">Rule code</span><input className="adm-input" value={rule.code} disabled={disabled} onChange={(event) => patchRule(rule.code, { code: event.target.value })} /></label>
                  <Toggle checked={rule.active} disabled={disabled} label={rule.active ? "Active in this draft" : "Inactive in this draft"} onChange={(active) => patchRule(rule.code, { active })} />
                  <button type="button" className="adm-btn small" disabled={disabled} onClick={() => removeRule(rule.code)}>Remove</button>
                </div>
                <div className={styles.ruleEditorGrid}>
                  <label className="adm-field"><span className="adm-field__label">Entity</span><select className="adm-select" value={rule.entity} disabled={disabled} onChange={(event) => {
                    const entity = event.target.value as IntelligenceEntity;
                    const field = Object.values(INTELLIGENCE_FIELDS).find((candidate) => candidate.entity === entity)!;
                    const group = operationalGroups.find((candidate) => candidate.scope === "both" || candidate.scope === entity);
                    patchRule(rule.code, { entity, field: field.field, group: group?.code ?? rule.group });
                  }}><option value="cargo">Cargo</option><option value="vessel">Vessel</option></select></label>
                  <label className="adm-field"><span className="adm-field__label">Group</span><select className="adm-select" value={rule.group} disabled={disabled} onChange={(event) => patchRule(rule.code, { group: event.target.value })}>{groups.map((group) => <option value={group.code} key={group.code}>{group.name}</option>)}</select></label>
                  <label className="adm-field"><span className="adm-field__label">Field</span><select className="adm-select" value={rule.field} disabled={disabled} onChange={(event) => patchRule(rule.code, { field: event.target.value as IntelligenceRuleV1["field"] })}>{fields.map((field) => <option value={field.field} key={field.field}>{field.label}{field.unit ? ` (${field.unit})` : ""}</option>)}</select></label>
                  <label className="adm-field"><span className="adm-field__label">Condition</span><select className="adm-select" value={rule.operator} disabled={disabled} onChange={(event) => {
                    const operator = event.target.value as IntelligenceOperator;
                    patchRule(rule.code, { operator, threshold: thresholdFor(operator, rule.threshold) });
                  }}>{OPERATORS.map((operator) => <option value={operator} key={operator}>{operator}</option>)}</select></label>
                  {rule.operator !== "missing" && rule.operator !== "between" && (
                    <label className="adm-field"><span className="adm-field__label">Threshold</span><input className="adm-input" type="number" step="any" value={typeof rule.threshold === "number" ? rule.threshold : 0} disabled={disabled} onChange={(event) => patchRule(rule.code, { threshold: numberValue(event.target.value) })} /></label>
                  )}
                  {rule.operator === "between" && (
                    <div className={styles.rangeFields}>
                      <label className="adm-field"><span className="adm-field__label">From</span><input className="adm-input" type="number" step="any" value={Array.isArray(rule.threshold) ? rule.threshold[0] : 0} disabled={disabled} onChange={(event) => patchRule(rule.code, { threshold: [numberValue(event.target.value), Array.isArray(rule.threshold) ? rule.threshold[1] : 0] })} /></label>
                      <label className="adm-field"><span className="adm-field__label">To</span><input className="adm-input" type="number" step="any" value={Array.isArray(rule.threshold) ? rule.threshold[1] : 0} disabled={disabled} onChange={(event) => patchRule(rule.code, { threshold: [Array.isArray(rule.threshold) ? rule.threshold[0] : 0, numberValue(event.target.value)] })} /></label>
                    </div>
                  )}
                  <label className="adm-field"><span className="adm-field__label">Severity</span><select className="adm-select" value={rule.severity} disabled={disabled} onChange={(event) => patchRule(rule.code, { severity: event.target.value as IntelligenceSeverity })}>{SEVERITIES.map((severity) => <option value={severity} key={severity}>{severity}</option>)}</select></label>
                  <label className="adm-field"><span className="adm-field__label">Priority</span><input className="adm-input" type="number" min={0} max={10000} value={rule.priority} disabled={disabled} onChange={(event) => patchRule(rule.code, { priority: numberValue(event.target.value) })} /></label>
                  <label className="adm-field"><span className="adm-field__label">Tag</span><input className="adm-input" value={rule.tag} disabled={disabled} onChange={(event) => patchRule(rule.code, { tag: event.target.value })} /></label>
                  <label className="adm-field"><span className="adm-field__label">Signal key</span><input className="adm-input" value={rule.signalKey} disabled={disabled} onChange={(event) => patchRule(rule.code, { signalKey: event.target.value })} /></label>
                  <label className={`adm-field ${styles.editorWide}`}><span className="adm-field__label">Member message</span><textarea className="adm-textarea" rows={2} value={rule.message} disabled={disabled} onChange={(event) => patchRule(rule.code, { message: event.target.value })} /></label>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {section === "groups" && (
        <section className={styles.structuredSection} aria-label="Rule groups editor">
          <div className={styles.structuredHead}><div><strong>Operational groups</strong><span>Groups organise rules; their scope constrains which facts a rule may use.</span></div><button type="button" className="adm-btn small" disabled={disabled} onClick={() => addGroup("both")}>Add group</button></div>
          {operationalGroups.map((group) => (
            <article className={styles.groupEditorCard} key={document.groups.indexOf(group)}>
              <div className={styles.ruleEditorGrid}>
                <label className="adm-field"><span className="adm-field__label">Code</span><input className="adm-input" value={group.code} disabled={disabled} onChange={(event) => patchGroup(group.code, { code: event.target.value })} /></label>
                <label className="adm-field"><span className="adm-field__label">Name</span><input className="adm-input" value={group.name} disabled={disabled} onChange={(event) => patchGroup(group.code, { name: event.target.value })} /></label>
                <label className="adm-field"><span className="adm-field__label">Scope</span><select className="adm-select" value={group.scope} disabled={disabled} onChange={(event) => patchGroup(group.code, { scope: event.target.value as Exclude<IntelligenceGroupScope, "framework"> })}>{SCOPES.map((scope) => <option value={scope} key={scope}>{scope}</option>)}</select></label>
                <label className="adm-field"><span className="adm-field__label">Priority</span><input className="adm-input" type="number" min={0} max={10000} value={group.priority} disabled={disabled} onChange={(event) => patchGroup(group.code, { priority: numberValue(event.target.value) })} /></label>
                <label className={`adm-field ${styles.editorWide}`}><span className="adm-field__label">Description</span><textarea className="adm-textarea" rows={2} value={group.description ?? ""} disabled={disabled} onChange={(event) => patchGroup(group.code, { description: event.target.value || null })} /></label>
              </div>
              <div className={styles.groupEditorActions}><Toggle checked={group.active} disabled={disabled} label={group.active ? "Active in this draft" : "Inactive in this draft"} onChange={(active) => patchGroup(group.code, { active })} /><button type="button" className="adm-btn small" disabled={disabled || document.rules.some((rule) => rule.group === group.code)} title={document.rules.some((rule) => rule.group === group.code) ? "Remove or move this group's rules first" : undefined} onClick={() => removeGroup(group.code)}>Remove</button></div>
            </article>
          ))}
        </section>
      )}

      {section === "frameworks" && (
        <section className={styles.structuredSection} aria-label="Framework placeholders editor">
          <div className={styles.structuredHead}><div><strong>Future frameworks</strong><span>Placeholders contain no executable rules and must remain inactive until a governed evaluator is released.</span></div><button type="button" className="adm-btn small" disabled={disabled} onClick={() => addGroup("framework")}>Add framework</button></div>
          {!frameworks.length && <div className="adm-empty">No framework placeholders in this draft.</div>}
          {frameworks.map((group) => (
            <article className={styles.groupEditorCard} key={document.groups.indexOf(group)}>
              <div className={styles.ruleEditorGrid}>
                <label className="adm-field"><span className="adm-field__label">Code</span><input className="adm-input" value={group.code} disabled={disabled} onChange={(event) => patchGroup(group.code, { code: event.target.value })} /></label>
                <label className="adm-field"><span className="adm-field__label">Name</span><input className="adm-input" value={group.name} disabled={disabled} onChange={(event) => patchGroup(group.code, { name: event.target.value })} /></label>
                <label className="adm-field"><span className="adm-field__label">Priority</span><input className="adm-input" type="number" min={0} max={10000} value={group.priority} disabled={disabled} onChange={(event) => patchGroup(group.code, { priority: numberValue(event.target.value) })} /></label>
                <label className={`adm-field ${styles.editorWide}`}><span className="adm-field__label">Description</span><textarea className="adm-textarea" rows={2} value={group.description ?? ""} disabled={disabled} onChange={(event) => patchGroup(group.code, { description: event.target.value || null })} /></label>
              </div>
              <div className={styles.groupEditorActions}><span className="adm-badge inactive">Inactive placeholder</span><button type="button" className="adm-btn small" disabled={disabled} onClick={() => removeGroup(group.code)}>Remove</button></div>
            </article>
          ))}
        </section>
      )}

      {section === "provenance" && (
        <section className={styles.structuredSection} aria-label="Rule provenance editor">
          <div className={styles.structuredHead}><div><strong>Evidence and change provenance</strong><span>Record the source and preserve the original guidance separately from member-facing copy.</span></div></div>
          {document.rules.map((rule) => {
            const entry = provenance.find((item) => item.ruleCode === rule.code);
            return (
              <article className={styles.groupEditorCard} key={document.rules.indexOf(rule)}>
                <div className={styles.provenanceTitle}><strong>{rule.code}</strong><span>{rule.message}</span></div>
                <div className={styles.ruleEditorGrid}>
                  <label className={`adm-field ${styles.editorWide}`}><span className="adm-field__label">Source reference</span><input className="adm-input" value={entry?.sourceRef ?? ""} disabled={disabled} onChange={(event) => patchProvenance(rule.code, { sourceRef: event.target.value })} /></label>
                  <label className={`adm-field ${styles.editorWide}`}><span className="adm-field__label">Original guidance</span><textarea className="adm-textarea" rows={2} value={entry?.originalMessage ?? ""} disabled={disabled} onChange={(event) => patchProvenance(rule.code, { originalMessage: event.target.value })} /></label>
                  <label className={`adm-field ${styles.editorWide}`}><span className="adm-field__label">Curator note (optional)</span><textarea className="adm-textarea" rows={2} value={entry?.note ?? ""} disabled={disabled} onChange={(event) => patchProvenance(rule.code, { note: event.target.value || null })} /></label>
                </div>
                {entry && <div className={styles.groupEditorActions}><button type="button" className="adm-btn small" disabled={disabled} onClick={() => onProvenanceChange(encode(provenance.filter((item) => item.ruleCode !== rule.code)))}>Remove provenance</button></div>}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
