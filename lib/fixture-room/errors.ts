// Fixture Room · error vocabulary (decision D6, 23 Sep 2026).
//
// The database raises with standard SQLSTATE classes and a stable FX_*:
// message prefix. The prefix is the primary discriminator (PostgREST relays
// the message verbatim); the SQLSTATE is the secondary one.

export type FixtureErrorCode =
  | "AUTH"                 // 42501 · not a party, wrong side or capacity, not admin
  | "STATE"                // 55000 · the room / term / subject state does not allow the command
  | "VERSION_CONFLICT"     // 55000 · expected_version is stale; currentVersion attached when the server says it (never 40001: PostgREST retries serialization failures)
  | "IDEMPOTENCY_MISMATCH" // P0001 · the same key with different arguments
  | "VALIDATION"           // 22023 · a bad value, a missing key, an over-long field
  | "NOT_FOUND"            // P0002 · room, term, proposal, party or listing missing
  | "CONFLICT"             // 23505 · an active room already covers the pairing (roomId attached)
  | "GATE"                 // 42501 · the creation tier gate
  | "IMMUTABLE"            // 55000 · a write touched an append-only row
  | "UNKNOWN";

export interface FixtureError {
  ok: false;
  code: FixtureErrorCode;
  message: string;
  currentVersion?: number;
  roomId?: string;
  sqlstate?: string;
}

const PREFIXES: Record<string, FixtureErrorCode> = {
  FX_AUTH: "AUTH",
  FX_STATE: "STATE",
  FX_VERSION_CONFLICT: "VERSION_CONFLICT",
  FX_IDEMPOTENCY_MISMATCH: "IDEMPOTENCY_MISMATCH",
  FX_VALIDATION: "VALIDATION",
  FX_NOT_FOUND: "NOT_FOUND",
  FX_CONFLICT: "CONFLICT",
  FX_GATE: "GATE",
  FX_IMMUTABLE: "IMMUTABLE",
};

const SQLSTATES: Record<string, FixtureErrorCode> = {
  "42501": "AUTH",
  "55000": "STATE",
  "22023": "VALIDATION",
  P0002: "NOT_FOUND",
  "23505": "CONFLICT",
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Map a database error (message + SQLSTATE) to the typed vocabulary. */
export function parseFixtureError(message: string | null | undefined, sqlstate?: string | null): FixtureError {
  const raw = (message ?? "").trim();
  const m = raw.match(/^(FX_[A-Z_]+):\s*([\s\S]*)$/);
  let code: FixtureErrorCode = "UNKNOWN";
  let text = raw || "Something went wrong.";
  if (m && PREFIXES[m[1]]) {
    code = PREFIXES[m[1]];
    text = m[2].trim() || text;
  } else if (sqlstate && SQLSTATES[sqlstate]) {
    code = SQLSTATES[sqlstate];
  }
  const out: FixtureError = { ok: false, code, message: text, sqlstate: sqlstate ?? undefined };
  if (code === "VERSION_CONFLICT") {
    const v = text.match(/version\s+(\d+)/i);
    if (v) out.currentVersion = Number(v[1]);
  }
  if (code === "CONFLICT") {
    const id = text.match(UUID);
    if (id) out.roomId = id[0];
  }
  return out;
}

/** Wording the UI shows per code when the server message is not itself user-facing. */
export const FIXTURE_ERROR_TITLE: Record<FixtureErrorCode, string> = {
  AUTH: "Not allowed",
  STATE: "Not possible right now",
  VERSION_CONFLICT: "The room moved on",
  IDEMPOTENCY_MISMATCH: "Duplicate request",
  VALIDATION: "Check the value",
  NOT_FOUND: "Not found",
  CONFLICT: "Already exists",
  GATE: "Subscriber feature",
  IMMUTABLE: "History is append-only",
  UNKNOWN: "Something went wrong",
};

export function isFixtureError(x: unknown): x is FixtureError {
  return !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false && typeof (x as { code?: unknown }).code === "string";
}
