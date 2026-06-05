"use client";

// Unsaved-changes guard, ported from the design (asb/unsaved-changes.jsx).
// useUnsavedGuard(dirty) arms a native beforeunload prompt; UnsavedDialog is the
// in-app confirmation for client-side navigation away from a dirty form.
import * as React from "react";
import { createPortal } from "react-dom";

export function useUnsavedGuard(dirty: boolean) {
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

export function UnsavedDialog({
  open,
  onSave,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onSave: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onKeep();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onKeep]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="asb-unsaved-backdrop" onMouseDown={onKeep} role="dialog" aria-modal="true">
      <div className="asb-unsaved" onMouseDown={(e) => e.stopPropagation()}>
        <div className="asb-unsaved__icon" aria-hidden>!</div>
        <h2 className="asb-unsaved__title">Unsaved changes</h2>
        <p className="asb-unsaved__body">
          You have unsaved changes on this page. If you leave now they will be lost.
        </p>
        <div className="asb-unsaved__actions">
          <button type="button" className="asb-unsaved__btn asb-unsaved__btn--primary" onClick={onSave}>Save as draft and leave</button>
          <button type="button" className="asb-unsaved__btn asb-unsaved__btn--secondary" onClick={onKeep}>Keep editing</button>
          <button type="button" className="asb-unsaved__btn asb-unsaved__btn--destructive" onClick={onDiscard}>Discard changes and leave</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
