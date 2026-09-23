// Where a queued workbook actually lives (workstream D, 21 Sep 2026).
//
// A 10 MB workbook used to travel to the database as a bytea hex string, so a
// 10 MB file became a 20 MB insert through PostgREST, and it was parsed once
// in the request and again in the worker. It now goes into a PRIVATE Storage
// bucket instead, and the job row carries only metadata: bucket, object path,
// byte count and SHA-256.
//
// The object path is minted here, on the server, and is never taken from the
// client:
//
//   jobs/<yyyy>/<mm>/<admin prefix>/<job id>-<32 hex of randomness>.xlsx
//
//   · bound to the job      the job id is in the path, so an object cannot be
//                           re-used for a different job
//   · bound to the admin    the first twelve characters of the uploading
//                           administrator's id, so an object cannot be
//                           re-pointed at someone else's upload
//   · unpredictable         128 bits of randomness, so a signed URL for one
//                           object tells nobody the name of another
//
// pathMatchesJob() is the check the finalise route runs before it trusts a
// path it reads back from the job row, and the check the worker runs before it
// downloads. Nothing in the module touches the network, so it is unit-tested
// directly (scripts/sync-upload-target-check.ts).

import { createHash, randomBytes } from "node:crypto";

/** The private bucket created by 20260920130000. */
export const SYNC_UPLOAD_BUCKET = "sync-uploads";
/** A signed upload target is short-lived: the browser uploads immediately or not at all. */
export const SIGNED_UPLOAD_TTL_SECONDS = 600;
/** The upload cap, matching the bucket's own file_size_limit. */
export const SYNC_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const HEX32 = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const adminPrefix = (adminId: string | null | undefined): string =>
  (adminId ?? "anonymous").replace(/[^0-9a-zA-Z]/g, "").slice(0, 12).toLowerCase() || "anonymous";

/** A fresh, unpredictable object path for one job. Server-side only. */
export function mintUploadObjectPath(input: { jobId: string; adminId: string | null; at?: Date }): string {
  if (!UUID.test(input.jobId)) throw new Error("mintUploadObjectPath: a job id (uuid) is required");
  const at = input.at ?? new Date();
  const yyyy = String(at.getUTCFullYear());
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `jobs/${yyyy}/${mm}/${adminPrefix(input.adminId)}/${input.jobId}-${randomBytes(16).toString("hex")}.xlsx`;
}

/**
 * Is this path one we minted for this job and this administrator? Returns the
 * reason it is not, or null. Rejects traversal, absolute paths, a foreign job
 * id, a foreign administrator and anything that is not our shape.
 */
export function pathMatchesJob(path: string, job: { id: string; started_by?: string | null }): string | null {
  if (typeof path !== "string" || path.length === 0) return "no object path";
  if (path.length > 512) return "the object path is too long";
  if (path.startsWith("/") || path.includes("..") || path.includes("\\") || /[\x00-\x1F]/.test(path)) return "the object path is malformed";
  const m = /^jobs\/(\d{4})\/(\d{2})\/([0-9a-z]+)\/([0-9a-f-]{36})-([0-9a-f]{32})\.xlsx$/.exec(path);
  if (!m) return "the object path is not one this server issued";
  if (m[4].toLowerCase() !== job.id.toLowerCase()) return "the object path belongs to a different job";
  if (!HEX32.test(m[5])) return "the object path is not one this server issued";
  if (m[3] !== adminPrefix(job.started_by)) return "the object path belongs to a different administrator";
  return null;
}

export const sha256Hex = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

/**
 * Does a downloaded object match what the uploader declared? Size and digest
 * are both checked, so a truncated download or a swapped object is refused
 * before SheetJS ever sees it.
 */
export function payloadProblem(buf: Buffer, declared: { size?: number | null; checksum?: string | null }): string | null {
  if (buf.length === 0) return "the stored workbook is empty";
  if (buf.length > SYNC_UPLOAD_MAX_BYTES) return `the stored workbook is ${buf.length} bytes, over the ${SYNC_UPLOAD_MAX_BYTES}-byte cap`;
  if (declared.size != null && declared.size !== buf.length) {
    return `the stored workbook is ${buf.length} bytes but the upload declared ${declared.size}`;
  }
  if (declared.checksum) {
    if (!/^[0-9a-f]{64}$/i.test(declared.checksum)) return "the declared checksum is not a SHA-256 digest";
    const actual = sha256Hex(buf);
    if (actual.toLowerCase() !== declared.checksum.toLowerCase()) {
      return `the stored workbook does not match its declared checksum (${actual.slice(0, 12)}… vs ${declared.checksum.slice(0, 12)}…)`;
    }
  }
  return null;
}
