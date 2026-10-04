"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import type { IntelligenceField } from "@/lib/intelligence";
import type {
  IntelligenceSignalView,
  IntelligenceSignalsView,
} from "@/lib/portal/types";
import styles from "./IntelligenceFlags.module.css";

const MARK: Readonly<Record<"good" | "info" | "warning" | "danger", string>> = {
  good: "\u2713",
  info: "i",
  warning: "!",
  danger: "!",
};

type TooltipPosition = {
  left: number;
  top: number;
};

const TOOLTIP_GAP = 7;
const VIEWPORT_GUTTER = 8;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function FieldSignal({
  signal,
  version,
}: {
  signal: IntelligenceSignalView;
  version: number;
}) {
  const descriptionId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const tooltipRef = React.useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = React.useState(false);
  const [pressedOpen, setPressedOpen] = React.useState(false);
  const [hoverDismissed, setHoverDismissed] = React.useState(false);
  const [position, setPosition] = React.useState<TooltipPosition | null>(null);
  const open = pressedOpen || (hovered && !hoverDismissed);

  React.useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const maximumLeft = Math.max(
        VIEWPORT_GUTTER,
        viewportWidth - VIEWPORT_GUTTER - tooltipRect.width,
      );
      const left = clamp(
        triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
        VIEWPORT_GUTTER,
        maximumLeft,
      );
      const topAbove = triggerRect.top - TOOLTIP_GAP - tooltipRect.height;
      const topBelow = triggerRect.bottom + TOOLTIP_GAP;
      const hasRoomAbove = topAbove >= VIEWPORT_GUTTER;
      const hasRoomBelow = topBelow + tooltipRect.height <= viewportHeight - VIEWPORT_GUTTER;
      const preferredTop = hasRoomAbove || !hasRoomBelow ? topAbove : topBelow;
      const maximumTop = Math.max(
        VIEWPORT_GUTTER,
        viewportHeight - VIEWPORT_GUTTER - tooltipRect.height,
      );

      setPosition({
        left,
        top: clamp(preferredTop, VIEWPORT_GUTTER, maximumTop),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, signal.message, signal.tag, version]);

  function dismiss() {
    setPressedOpen(false);
    if (hovered) setHoverDismissed(true);
  }

  const tooltip = open && typeof document !== "undefined"
    ? createPortal(
        <span
          ref={tooltipRef}
          id={descriptionId}
          role="tooltip"
          className={`${styles.tooltip} ${position ? "" : styles.tooltipPending}`}
          style={position ?? undefined}
        >
          <strong>{signal.tag}</strong>
          <span>{signal.message}</span>
          <small>Rule {signal.ruleCode} · rules v{version}</small>
        </span>,
        document.body,
      )
    : null;

  return (
    <>
      <span
        className={styles.signal}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
          setHoverDismissed(false);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
            triggerRef.current?.focus();
          }
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          className={`${styles.trigger} ${styles[signal.severity]}`}
          aria-describedby={open ? descriptionId : undefined}
          aria-expanded={open}
          data-intelligence-rule={signal.ruleCode}
          onClick={(event) => {
            event.stopPropagation();
            const next = !pressedOpen;
            setPressedOpen(next);
            setHoverDismissed(!next && hovered);
          }}
        >
          <span aria-hidden="true">{MARK[signal.severity]}</span>
          <span className={styles.srOnly}>{signal.tag} intelligence signal</span>
        </button>
      </span>
      {tooltip}
    </>
  );
}

/** Advisory, field-local signals from the active governed rule set. */
export function IntelligenceFieldFlags({
  intelligence,
  field,
}: {
  intelligence?: IntelligenceSignalsView;
  field: IntelligenceField;
}) {
  if (!intelligence || intelligence.status !== "available") return null;
  const signals = intelligence.signals.filter((signal) => signal.field === field);
  if (!signals.length) return null;

  return (
    <span
      className={styles.flags}
      aria-label={`${signals.length} intelligence signal${signals.length === 1 ? "" : "s"}`}
    >
      {signals.map((signal) => (
        <FieldSignal key={signal.ruleCode} signal={signal} version={intelligence.version} />
      ))}
    </span>
  );
}

export function IntelligenceAvailabilityNotice({
  intelligence,
}: {
  intelligence?: IntelligenceSignalsView;
}) {
  if (intelligence?.status !== "unavailable") return null;
  return (
    <div className={styles.unavailable} role="status">
      Intelligence checks unavailable.
    </div>
  );
}
