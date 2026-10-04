"use client";

import styles from "./AccessibleIdentifier.module.css";

export function AccessibleIdentifier({
  label,
  value,
  length = 12,
}: {
  label: string;
  value: string | null | undefined;
  length?: number;
}) {
  if (!value) return <code>—</code>;
  const compact = value.length > length ? `${value.slice(0, length)}…` : value;
  if (compact === value) return <code>{value}</code>;
  return (
    <details className={styles.value}>
      <summary aria-label={`Show full ${label}`}>{compact}</summary>
      <span className={styles.popover} role="note">
        <strong>{label}</strong>
        <code>{value}</code>
      </span>
    </details>
  );
}
