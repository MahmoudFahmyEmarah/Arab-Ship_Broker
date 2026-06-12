"use client";

// Mobile bottom-sheet handle (portal boards). Tapping it toggles the list
// sheet between its half-height and a peek bar, which doubles as the
// full-screen-map control. Visible only on phones via CSS (.mkt-sheet-handle
// is display:none above the 900px breakpoint). The grip + label give a clear
// drag/tap affordance so dragging the sheet never scrolls the page behind it.
import * as React from "react";

// Shared sheet state: on phones the list starts PEEKED so the map is the
// surface ("almost full map, everything on it"); records are one tap away.
// Desktop ignores this entirely (the sheet CSS only exists <=900px).
export function useSheetPeek(): [boolean, () => void] {
  const [peek, setPeek] = React.useState(false);
  React.useEffect(() => {
    if (window.matchMedia?.("(max-width: 900px)").matches) setPeek(true);
  }, []);
  return [peek, React.useCallback(() => setPeek((p) => !p), [])];
}

export function SheetHandle({
  peek,
  onToggle,
  label,
}: {
  peek: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="mkt-sheet-handle"
      onClick={onToggle}
      aria-label={peek ? "Expand list" : "Minimize list for full-screen map"}
    >
      <span className="mkt-sheet-grip" aria-hidden />
      {label && <span className="mkt-sheet-label">{peek ? `▲ ${label}` : label}</span>}
    </button>
  );
}
