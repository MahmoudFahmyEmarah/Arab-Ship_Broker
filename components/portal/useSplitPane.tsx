"use client";

// Resizable split pane — the draggable divider between the list and the map
// (same behaviour as the Dashboard board). Returns the left-pane width (%) plus
// the container ref and the divider's mousedown handler; pair with <SplitDivider/>.
import * as React from "react";

export function useSplitPane(initialPct = 50, min = 28, max = 72) {
  const [pct, setPct] = React.useState(initialPct);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);

  const onDividerMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const p = ((ev.clientX - rect.left) / rect.width) * 100;
        setPct(Math.max(min, Math.min(max, p)));
      };
      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [min, max],
  );

  return { pct, containerRef, onDividerMouseDown };
}

export function SplitDivider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to resize"
      style={{
        width: 10,
        flexShrink: 0,
        cursor: "col-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <div style={{ width: 3, height: 36, borderRadius: 999, background: "#cbd5e1" }} />
    </div>
  );
}
