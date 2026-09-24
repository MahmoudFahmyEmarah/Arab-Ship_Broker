"use client";

// Fixture Room · client helpers: idempotency keys per gesture and the version
// poll (v1 uses polling instead of Realtime; the persisted state is the truth).
import * as React from "react";

/** One key per user gesture; kept for the gesture's retries so a retry replays. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Polls the room version while the tab is visible and calls onChange when it
 * moves. The interval is generous (5 s) because every command already
 * refetches the room; the poll only catches the OTHER side's moves.
 */
export function useRoomVersionPoll(
  roomId: string,
  currentVersion: number,
  poll: (roomId: string) => Promise<number | null>,
  onChange: (version: number) => void,
  intervalMs = 5000,
) {
  const versionRef = React.useRef(currentVersion);
  React.useEffect(() => { versionRef.current = currentVersion; }, [currentVersion]);
  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (!alive) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        try {
          const v = await poll(roomId);
          if (alive && v != null && v !== versionRef.current) onChange(v);
        } catch {
          // a failed poll is not a state change; the next tick tries again
        }
      }
      if (alive) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [roomId, poll, onChange, intervalMs]);
}

/**
 * A ticking clock for countdowns and relative times. It is 0 until the
 * component has mounted, so server and client render the same markup (a
 * clock read during server rendering is a hydration mismatch); the
 * formatters return nothing for 0.
 */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
