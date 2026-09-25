"use client";

// Fixture Room · client helpers: idempotency keys per gesture, the gesture
// runner that keeps a key until the server has answered definitively (audit
// FR-M5), and the version poll (v1 uses polling instead of Realtime; the
// persisted state is the truth).
import * as React from "react";
import type { FixtureError } from "./errors";

/** One key per user gesture; kept for the gesture's retries so a retry replays. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The outcome of one attempt at a command:
 *   ok        the server committed and answered (the envelope);
 *   refused   the server answered with a typed refusal (FX_*): definitive,
 *             nothing was written;
 *   uncertain the transport failed before an answer arrived. The server MAY
 *             have committed. The gesture's key is kept, so the next attempt
 *             replays instead of repeating.
 */
export type CommandOutcome<T> =
  | { kind: "ok"; result: T }
  | { kind: "refused"; error: FixtureError }
  | { kind: "uncertain"; error: unknown; key: string };

/**
 * Keys per gesture. A key lives from the first attempt until a definitive
 * answer (ok or refused); a transport failure keeps it. Pure and synchronous
 * so scripts/fixture-room-check.ts can prove the retry contract without React.
 */
export class GestureKeys {
  private readonly keys = new Map<string, string>();
  constructor(private readonly mint: () => string = newIdempotencyKey) {}
  /** The key for this gesture: the retained one after an uncertain attempt, otherwise a fresh one. */
  keyFor(gesture: string): string {
    let k = this.keys.get(gesture);
    if (!k) { k = this.mint(); this.keys.set(gesture, k); }
    return k;
  }
  /** Called after a definitive answer: the next gesture of this name is a new command. */
  settle(gesture: string) { this.keys.delete(gesture); }
  /** Whether an earlier attempt of this gesture is still unanswered. */
  pending(gesture: string): boolean { return this.keys.has(gesture); }
}

const isEnvelope = (x: unknown): x is { ok: boolean } => !!x && typeof x === "object" && "ok" in (x as Record<string, unknown>);

/**
 * Runs one attempt of a gesture. `send` receives the key to put in the
 * command and returns the server's answer (an ok envelope or a FixtureError);
 * a throw is a transport failure. The key is released only on an answer.
 */
export async function runGesture<T extends { ok: true }>(
  keys: GestureKeys,
  gesture: string,
  send: (idempotencyKey: string) => Promise<T | FixtureError>,
): Promise<CommandOutcome<T>> {
  const key = keys.keyFor(gesture);
  let answer: T | FixtureError;
  try {
    answer = await send(key);
  } catch (error) {
    return { kind: "uncertain", error, key };
  }
  if (!isEnvelope(answer)) return { kind: "uncertain", error: new Error("malformed answer"), key };
  keys.settle(gesture);
  if (answer.ok) return { kind: "ok", result: answer };
  return { kind: "refused", error: answer };
}

/** The message a user sees after an uncertain attempt. */
export const UNCERTAIN_MESSAGE = "The request did not get an answer. The room was refreshed; if your change is not there, try again — a retry reuses the same request and cannot double-apply.";

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
